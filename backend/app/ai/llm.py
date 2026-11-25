from typing import Optional, Dict, Any, List
import httpx
import json
from app.config import settings


class LLMProvider:
    """Abstract LLM provider interface."""

    async def generate(self, prompt: str, **kwargs) -> str:
        raise NotImplementedError


class OpenAIProvider(LLMProvider):
    """OpenAI GPT provider."""

    def __init__(self):
        self.api_key = settings.openai_api_key
        self.model = settings.openai_model
        if settings.llm_provider == "groq":
            self.api_url = "https://api.groq.com/openai/v1/chat/completions"
        else:
            self.api_url = "https://api.openai.com/v1/chat/completions"

    async def generate(self, prompt: str, **kwargs) -> str:
        """Generate response using OpenAI API."""
        if not self.api_key:
            return self._mock_response(prompt)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        # messages: full multi-turn list when LLMManager passes one
        # (proper OpenAI roles); fall back to a single user message.
        data = {
            "model": self.model,
            "messages": kwargs.get("messages") or [{"role": "user", "content": prompt}],
            "temperature": kwargs.get("temperature", 0.7),
            # 4000 tokens (~3000 words): enough for fuller, multi-step
            # explanations. gpt-4o-mini allows up to 16k output tokens.
            "max_tokens": kwargs.get("max_tokens", 4000)
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    self.api_url,
                    headers=headers,
                    json=data,
                    timeout=60.0
                )
                response.raise_for_status()
                result = response.json()
                return result["choices"][0]["message"]["content"]
            except httpx.HTTPError:
                return self._mock_response(prompt)

    def _mock_response(self, prompt: str) -> str:
        """Mock response when API key is not set."""
        return (
            "[Placeholder] Đây là câu trả lời mẫu.\n\n"
            f"Câu hỏi của bạn: {prompt[:100]}...\n\n"
            "Vui lòng cấu hình API key để sử dụng AI thực sự."
        )


class AnthropicProvider(LLMProvider):
    """Anthropic Claude provider."""

    def __init__(self):
        self.api_key = settings.anthropic_api_key
        self.model = settings.anthropic_model
        self.api_url = "https://api.anthropic.com/v1/messages"

    async def generate(self, prompt: str, **kwargs) -> str:
        """Generate response using Anthropic API."""
        if not self.api_key:
            return self._mock_response(prompt)

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        }

        data = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 4000)
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    self.api_url,
                    headers=headers,
                    json=data,
                    timeout=60.0
                )
                response.raise_for_status()
                result = response.json()
                return result["content"][0]["text"]
            except httpx.HTTPError:
                return self._mock_response(prompt)

    def _mock_response(self, prompt: str) -> str:
        """Mock response when API key is not set."""
        return (
            "[Placeholder] Đây là câu trả lời mẫu.\n\n"
            f"Câu hỏi của bạn: {prompt[:100]}...\n\n"
            "Vui lòng cấu hình API key để sử dụng AI thực sự."
        )


class LLMManager:
    """Manager for LLM providers."""

    def __init__(self):
        self._provider = None

    @property
    def provider(self) -> LLMProvider:
        if self._provider is None:
            if settings.llm_provider == "openai":
                self._provider = OpenAIProvider()
            elif settings.llm_provider == "anthropic":
                self._provider = AnthropicProvider()
            else:
                self._provider = OpenAIProvider()  # Default
        return self._provider

    async def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
        **kwargs
    ) -> str:
        """Generate response with optional system prompt and multi-turn history.

        Builds a proper OpenAI `messages` array: [system?, ...history, user].
        When `history` is omitted (or empty), falls back to the legacy single
        user message built from `system_prompt + prompt` so callers that do
        not pass history behave exactly as before.
        """
        if history:
            messages: List[Dict[str, Any]] = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.extend(history)
            messages.append({"role": "user", "content": prompt})
            return await self.provider.generate(prompt, messages=messages, **kwargs)

        full_prompt = prompt
        if system_prompt:
            full_prompt = f"{system_prompt}\n\n{prompt}"
        return await self.provider.generate(full_prompt, **kwargs)

    async def generate_quiz(
        self,
        topic: str,
        num_questions: int,
        difficulty: str,
        context: Optional[str] = None,
        subject: Optional[str] = None,
        excluded: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Generate quiz questions using LLM.

        `excluded` (question texts already seen by the user) is passed so the
        model produces NEW questions instead of repeating the same ones.
        """
        scope = subject or topic
        prompt = f"""Tạo {num_questions} câu hỏi trắc nghiệm mới về phạm vi: {topic} (môn: {scope})
Độ khó: {difficulty}
Mỗi câu hỏi có 4 đáp án, chỉ 1 đáp án đúng.
Câu hỏi phải khác nhau về nội dung; tuyệt đối không lặp lại các câu dưới đây (nếu có):
{chr(10).join('- ' + e for e in (excluded or [])) if excluded else '(chưa có câu trước)'}
Trả lời theo format JSON như sau:
[
  {{
    "question_text": "Câu hỏi...",
    "options": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
    "correct_answer": 0,
    "explanation": "Giải thích..."
  }}
]"""

        if context:
            prompt = f"Dựa trên nội dung sau:\n{context}\n\n{prompt}"

        response = await self.generate(prompt)

        # Try to parse JSON from response
        try:
            # Extract JSON from response
            json_start = response.find("[")
            json_end = response.rfind("]") + 1
            if json_start != -1 and json_end != 0:
                return json.loads(response[json_start:json_end])
        except json.JSONDecodeError:
            pass

        return []

    def _parse_json_array(self, response: str) -> List[Dict[str, Any]]:
        """Extract and parse the first JSON array in a free-form LLM response."""
        if not response:
            return []
        try:
            start = response.find("[")
            end = response.rfind("]") + 1
            if start != -1 and end > start:
                parsed = json.loads(response[start:end])
                if isinstance(parsed, list):
                    return [q for q in parsed if isinstance(q, dict)]
        except json.JSONDecodeError:
            pass
        return []

    def _parse_json_object(self, response: str) -> Optional[Dict[str, Any]]:
        """Extract and parse the first JSON object in a free-form LLM response."""
        if not response:
            return None
        try:
            start = response.find("{")
            end = response.rfind("}") + 1
            if start != -1 and end > start:
                parsed = json.loads(response[start:end])
                if isinstance(parsed, dict):
                    return parsed
        except json.JSONDecodeError:
            pass
        return None

    async def verify_quiz_question(
        self,
        subject: str,
        topic: Optional[str],
        question: Dict[str, Any],
        context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """AI critic: does this generated question actually belong to the
        subject/topic, and is the marked answer correct?

        Returns {"ok": bool, "reason": str}. A missing/unknown `ok` is
        treated as NOT verified (fail-closed) so only confirmed questions
        reach the shared bank.
        """
        scope = topic or subject
        prompt = f"""Bạn là giám khảo câu hỏi. Kiểm tra câu hỏi sau thuộc đúng phạm vi "{scope}" (môn: {subject}) và đáp án được đánh dấu là ĐÚNG.
{f"Nội dung tham khảo:\n{context}\n" if context else ""}
Câu hỏi: {question.get('question_text')}
Đáp án: {question.get('options')}
Đáp án đúng (index): {question.get('correct_answer')}

Trả lời JSON ngắn gọn: {{"ok": true|false, "reason": "lý do"}}
Chỉ trả lời JSON, không kèm văn bản khác."""
        response = await self.generate(prompt)
        verdict = self._parse_json_object(response) or {}
        ok = bool(verdict.get("ok"))
        reason = str(verdict.get("reason") or "").strip()
        if not reason:
            reason = "Đáp án chưa rõ ràng" if not ok else "Đúng phạm vi"
        return {"ok": ok, "reason": reason}

    async def suggest_topics(
        self,
        subject: str,
        context: Optional[str] = None,
        limit: int = 8,
        existing_topics: Optional[List[str]] = None,
    ) -> List[str]:
        """Ask the LLM for the main topics covered in the provided document
        context. Returns a list of topic names (may be empty).

        `existing_topics`, when given, asks the model to skip anything that
        means the same as one of them - even phrased differently (e.g.
        "Entropy" vs "Entropy thông tin") - which a plain string-equality
        dedupe downstream can't catch.
        """
        existing_block = ""
        if existing_topics:
            bullet_list = "\n".join(f"- {t}" for t in existing_topics)
            existing_block = (
                f"\n\nCác chủ đề đã có sẵn cho môn này (KHÔNG liệt kê lại, kể cả khi diễn đạt khác đi "
                f"nhưng cùng một ý):\n{bullet_list}\n"
            )
        prompt = f"""Từ nội dung tài liệu của môn "{subject}" dưới đây, liệt kê tối đa {limit} chủ đề kiến thức chính MỚI được đề cập (rút gọn, đúng lĩnh vực, không trùng nhau).{existing_block}
{context or "(không có nội dung)"}

Trả lời JSON: {{"topics": ["chủ đề 1", "chủ đề 2", ...]}}
Chỉ trả lời JSON. Nếu không có chủ đề nào thực sự mới, trả {{"topics": []}}."""
        response = await self.generate(prompt)
        parsed = self._parse_json_object(response) or {}
        topics = parsed.get("topics") or []
        result: List[str] = []
        for t in topics:
            if isinstance(t, str) and t.strip():
                result.append(t.strip())
            if len(result) >= limit:
                break
        return result

    async def order_topics(
        self,
        subject: str,
        ordered: List[str],
        new_topics: List[str],
    ) -> List[str]:
        """Merge `new_topics` into `ordered`, asking the LLM to place every
        topic in a sensible learn-this-before-that sequence (used by Lộ
        trình's real topic gating - see PathService.topic_progress).

        Strictly validated: the result is only trusted if it contains EXACTLY
        the same set of topics as `ordered | new_topics` (no dropped/added/
        reworded entries). Any mismatch, or an unusable response, falls back
        to the old behavior of just appending `new_topics` at the end - never
        loses a topic.
        """
        fallback = ordered + [t for t in new_topics if t not in ordered]
        if not new_topics:
            return ordered
        expected = set(ordered) | set(new_topics)

        existing_block = (
            "\n".join(f"{i+1}. {t}" for i, t in enumerate(ordered))
            if ordered else "(chưa có chủ đề nào)"
        )
        new_block = "\n".join(f"- {t}" for t in new_topics)
        prompt = f"""Môn học: "{subject}".
Danh sách chủ đề đã có, ĐANG theo đúng thứ tự nên học trước-sau:
{existing_block}

Các chủ đề MỚI cần chèn thêm vào danh sách trên (giữ nguyên chữ, không viết lại):
{new_block}

Hãy trả về TOÀN BỘ danh sách (cả chủ đề cũ và mới), sắp xếp lại theo đúng thứ tự
nên học trước - sau hợp lý nhất cho môn này (kiến thức nền trước, nâng cao sau).
Giữ nguyên văn từng chủ đề (không đổi chữ, không bỏ sót, không thêm chủ đề khác).

Trả lời JSON: {{"topics": ["chủ đề theo đúng thứ tự", ...]}}
Chỉ trả lời JSON."""
        response = await self.generate(prompt)
        parsed = self._parse_json_object(response) or {}
        topics = parsed.get("topics")
        if not isinstance(topics, list):
            return fallback
        result = [t.strip() for t in topics if isinstance(t, str) and t.strip()]
        if set(result) != expected or len(result) != len(expected):
            return fallback
        return result

    async def summarize_topic(self, subject: str, topic: str, context: Optional[str] = None) -> str:
        """Write a short, beginner-friendly explanation of `topic` for the
        subject's Lộ trình "Học" screen, grounded in `context` (RAG excerpts)
        when available. Plain prose, not JSON - returned as-is."""
        if context:
            prompt = f"""Viết một bài tóm tắt/giải thích ngắn gọn, dễ hiểu về chủ đề "{topic}"
trong môn "{subject}", dựa trên nội dung tài liệu dưới đây. Khi dùng thông tin cụ
thể từ tài liệu, trích nguồn ngay trong câu văn (tên tài liệu, trang nếu có).
Viết bằng tiếng Việt, khoảng 150-250 từ, văn phong gần gũi như đang giảng cho
người mới học.

{context}"""
        else:
            prompt = f"""Viết một bài tóm tắt/giải thích ngắn gọn, dễ hiểu về chủ đề "{topic}"
trong môn "{subject}" bằng kiến thức chung (chưa có tài liệu nào của người học về
chủ đề này). Viết bằng tiếng Việt, khoảng 150-250 từ, văn phong gần gũi như đang
giảng cho người mới học. Mở đầu bằng 1 câu lưu ý ngắn là nội dung này chưa được
đối chiếu với tài liệu cụ thể của người học."""
        response = await self.generate(prompt)
        return response.strip()

    async def grade_essay(self, prompt: str, rubric_json: str, essay: str) -> Optional[Dict[str, Any]]:
        """Ask the LLM to score an essay strictly against a barem (rubric).

        Returns the raw parsed {"scores": [...], "total", "max_total",
        "overall"} object, or None when the response is unusable (the caller
        then falls back to 60% of each criterion)."""
        user_prompt = (
            f"ĐỀ: {prompt}\n"
            f"BAREM: {rubric_json}\n"
            f"BÀI LÀM:\n{essay}"
        )
        response = await self.generate(
            user_prompt,
            system_prompt=(
                "Bạn là giáo viên chấm tự luận. Chỉ trả JSON, không giải thích: "
                "{scores:[{criterion, score, max, quote, feedback}], total, max_total, overall}. "
                "Trích quote đúng câu trong bài làm. Chấm chặt theo barem."
            ),
            temperature=0.1,
            max_tokens=1500,
        )
        return self._parse_json_object(response) if response else None


# Singleton instance
llm_manager = LLMManager()
