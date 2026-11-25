from typing import Optional, List, Dict, Any
from uuid import UUID
import json
from app.ai.rag import RAGPipeline
from app.ai.llm import llm_manager
from app.ai.figures import inspect_top_figure
from app.config import settings


# System prompts
# Note on math: the frontend renders math via remark-math + katex, but ONLY
# when the model wraps formulas in $...$ (inline) or $$...$$ (display). A bare
# "x^2" is shown literally. So every math-capable prompt below carries MATH_RULE.
MATH_RULE = (
    "- Khi viết công thức / biểu thức toán, LUÔN bọc bằng $...$ (trong câu) và "
    "$$...$$ (cô lập) để render dạng toán. Ví dụ: $x^2$, $\\frac{a}{b}$, "
    "$\\int f(x)\\,dx$, $\\log_2 n$ — KHÔNG viết trần như x^2 hay a/b."
)

# Minimal chat prompt: the app is a thin passthrough between the user and the
# model. No persona / style instructions - the model answers in its default
# voice. MATH_RULE is kept because the frontend renders math only when the
# model wraps formulas in $...$ / $$...$$ (remark-math + katex).
SYSTEM_PROMPT_CHAT = """Bạn là AI Gia Sư học tập. Trả lời bằng tiếng Việt, tự nhiên, đúng trọng tâm.
Nếu không chắc, nói rõ là không chắc và gợi ý cách kiểm tra - không bịa.
""" + MATH_RULE

SYSTEM_PROMPT_RAG = """Bạn là AI Gia Sư, một trợ lý học tập tiếng Việt.
Khi nội dung tài liệu được cung cấp bên dưới:
- Chỉ dùng nó khi câu hỏi THỰC SỰ liên quan đến nội dung đó; trích dẫn nguồn (tên tài liệu) khi dùng.
- Nếu câu hỏi không liên quan đến tài liệu, hãy trả lời bằng kiến thức chung như một cuộc hỏi đáp bình thường - KHÔNG nhắc "không tìm thấy trong tài liệu" hay từ chối.
- Không bịa: không có gì trong tài liệu thì rõ ràng chia tách "theo tài liệu" với "kiến thức chung".
- Trả lời rõ ràng, đúng trọng tâm, bằng tiếng Việt.
""" + MATH_RULE

class AIOrchestrator:
    """
    Orchestrates AI requests to appropriate handlers.
    Routes requests to Chat, RAG, Quiz, Code, or Voice pipelines.
    """

    def __init__(self):
        self.rag_pipeline = RAGPipeline()

    async def process_request(
        self,
        user_id: UUID,
        message: str,
        mode: str = "chat",
        conversation_history: Optional[List[Dict[str, str]]] = None,
        document_ids: Optional[List[UUID]] = None
    ) -> Dict[str, Any]:
        """
        Process user request based on mode.

        Modes:
        - chat: Regular conversation with LLM
        - rag: Question answering with document retrieval
        """
        if mode == "rag":
            return await self._process_rag(
                user_id=user_id,
                message=message,
                document_ids=document_ids,
                conversation_history=conversation_history
            )
        else:
            return await self._process_chat(
                message=message,
                conversation_history=conversation_history
            )

    async def _process_chat(
        self,
        message: str,
        conversation_history: Optional[List[Dict[str, str]]] = None
    ) -> Dict[str, Any]:
        """Process a regular chat request as a thin passthrough.

        No text-pasted "conversation so far" block: the history is sent as a
        proper multi-turn `messages` array (each turn its own user/assistant
        message) so the model understands the conversation structure natively.
        """
        # History: keep only user/assistant turns that have content, in order.
        # (The most recent N are already bounded upstream via
        # settings.ask_memory_messages - see chat_service._get_history_for_context.)
        history = [
            {"role": m["role"], "content": m["content"]}
            for m in (conversation_history or [])
            if m.get("role") in ("user", "assistant") and m.get("content")
        ]

        response = await llm_manager.generate(
            prompt=message,
            system_prompt=SYSTEM_PROMPT_CHAT,
            history=history
        )

        return {
            "content": response,
            "mode": "chat",
            "sources": None
        }

    async def _process_rag(
        self,
        user_id: UUID,
        message: str,
        document_ids: Optional[List[UUID]] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None
    ) -> Dict[str, Any]:
        """Process a document-grounded question.

        Retrieval is a SUGGESTION, not a gate: when the search returns
        nothing relevant, the question is answered from general knowledge
        (same as plain chat) instead of refusing - a subject's documents are
        reference material for related questions, not the only source.
        """
        # Search documents
        search_results = await self.rag_pipeline.search_documents(
            query=message,
            user_id=user_id,
            document_ids=document_ids,
            limit=8
        )

        # Build context (empty when nothing relevant was retrieved)
        context = self.rag_pipeline.build_context(message, search_results)
        sources = self.rag_pipeline.extract_sources(search_results)

        # No relevant chunks: answer as a normal chat question (no document
        # context, no sources) so unrelated questions are not blocked.
        if not search_results:
            return await self._process_chat(
                message=message,
                conversation_history=conversation_history
            )

        # Query-time vision: when the top hits include a figure, let the
        # vision model look at the ACTUAL image (not just the caption) and
        # fold its analysis into the context. This is what makes figure-heavy
        # questions answerable - the model sees the real pixels.
        figure_note = await inspect_top_figure(user_id, message, search_results)

        # RAG prompt: the document context (and figure analysis, when present)
        # are the "material" for this turn, so they live in the CURRENT user
        # message. History is a separate multi-turn array (R1) so the model
        # follows the conversation properly.
        prompt_parts = []
        prompt_parts.append(f"Câu hỏi: {message}")
        prompt_parts.append(f"\n{context}")
        if figure_note:
            prompt_parts.append(f"\nPHÂN TÍCH HÌNH (do mô hình thị giác nhìn ảnh gốc): {figure_note}")
        prompt = "\n\n".join(prompt_parts)

        history = [
            {"role": m["role"], "content": m["content"]}
            for m in (conversation_history or [])
            if m.get("role") in ("user", "assistant") and m.get("content")
        ]

        # Generate response (R3: temperature 0.3 keeps RAG answers tighter and
        # more document-grounded than plain chat's default 0.7)
        response = await llm_manager.generate(
            prompt=prompt,
            system_prompt=SYSTEM_PROMPT_RAG,
            history=history,
            temperature=0.3
        )

        return {
            "content": response,
            "mode": "rag",
            "sources": sources
        }

    async def generate_quiz(
        self,
        topic: str,
        num_questions: int,
        difficulty: str,
        context: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Generate quiz questions using LLM."""
        return await llm_manager.generate_quiz(
            topic=topic,
            num_questions=num_questions,
            difficulty=difficulty,
            context=context
        )

    async def explain_code(
        self,
        code: str,
        context: Optional[str] = None
    ) -> str:
        """Explain Python code."""
        prompt = f"""Giải thích đoạn code Python sau:
```python
{code}
```
"""
        if context:
            prompt = f"Ngữ cảnh: {context}\n\n{prompt}"

        prompt += "\n\nHãy giải thích từng phần của code."

        return await llm_manager.generate(prompt=prompt)


# Singleton instance
ai_orchestrator = AIOrchestrator()
