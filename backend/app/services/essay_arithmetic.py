"""Check exact answers to arithmetic and linear equations for a correctness-only rubric."""

import ast
import operator
import re
from fractions import Fraction


ADDITIVE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
}
CORRECTNESS_CRITERIA = {
    "đúng",
    "kết quả đúng",
    "kết quả chính xác",
    "đáp án đúng",
    "đáp án chính xác",
}
SYMBOLS = str.maketrans({"−": "-", "–": "-", "×": "*", "÷": "/", ":": "/", ",": "."})
NUMERIC_ANSWER = re.compile(r"[+-]?\s*(?:[0-9]+(?:\.[0-9]+)?|[0-9]+\s*/\s*[+-]?\s*[0-9]+)")


def evaluate(node: ast.AST, expression: str, variable: str | None = None) -> tuple[Fraction, Fraction]:
    """Return the coefficient of the variable and the constant term."""
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        return Fraction(0), Fraction(ast.get_source_segment(expression, node))
    if isinstance(node, ast.Name) and node.id == variable:
        return Fraction(1), Fraction(0)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        coefficient, constant = evaluate(node.operand, expression, variable)
        return (-coefficient, -constant) if isinstance(node.op, ast.USub) else (coefficient, constant)
    if isinstance(node, ast.BinOp):
        left_coefficient, left_constant = evaluate(node.left, expression, variable)
        right_coefficient, right_constant = evaluate(node.right, expression, variable)
        if operation := ADDITIVE_OPERATORS.get(type(node.op)):
            return operation(left_coefficient, right_coefficient), operation(left_constant, right_constant)
        if isinstance(node.op, ast.Mult) and not (left_coefficient and right_coefficient):
            return (left_coefficient * right_constant + right_coefficient * left_constant,
                    left_constant * right_constant)
        if isinstance(node.op, ast.Div) and not right_coefficient:
            return left_coefficient / right_constant, left_constant / right_constant
    raise ValueError("Unsupported arithmetic")


def parse_expression(expression: str, variable: str | None = None) -> ast.AST:
    letter = re.escape(variable) if variable else ""
    if not re.fullmatch(rf"[0-9+*/().\- \t{letter}]{{1,160}}", expression):
        raise ValueError("Unsupported expression")
    return ast.parse(expression, mode="eval").body


def answer_text(essay: str) -> str:
    return re.sub(
        r"^(?:(?:đáp số|kết quả|đáp án)\s*(?:[:：]|là\b)|vậy\b\s*[:：]?|⇒|→)\s*",
        "", essay.strip(), flags=re.IGNORECASE,
    ).translate(SYMBOLS)


def check_arithmetic(prompt: str, essay: str) -> tuple[Fraction, list[Fraction]] | None:
    task = re.sub(r"^tính(?:\s*:\s*|\s+)", "", prompt.strip(), flags=re.IGNORECASE)
    task = re.sub(r"(?:=\s*)?\?\s*$", "", task).translate(SYMBOLS).strip()
    submission = answer_text(essay)
    if len(submission) > 400:
        return None
    terms = [part.strip() for part in submission.split("=")]
    if not NUMERIC_ANSWER.fullmatch(terms[-1].rstrip(".")):
        return None
    try:
        question = parse_expression(task)
        if not isinstance(question, ast.BinOp):
            return None
        _, expected = evaluate(question, task)
        submitted = [evaluate(parse_expression(part), part)[1] for part in terms]
    except (SyntaxError, ValueError, ZeroDivisionError):
        return None
    return expected, submitted


def check_equation(prompt: str, essay: str) -> tuple[str, Fraction, Fraction] | None:
    if len(prompt) > 400 or len(essay) > 400:
        return None
    task = prompt.strip()
    prefix = re.match(
        r"^(?:tìm\s+([a-z])\b(?:\s+biết\b)?|giải\s+phương\s+trình\b)\s*[:：,]?\s*",
        task, flags=re.IGNORECASE,
    )
    if prefix:
        task = task[prefix.end():]
    request = re.search(r"[\s,;.!⇒→]+(?:vậy\s+)?([a-z])\s*=\s*\?\s*$", task, flags=re.IGNORECASE)
    if request:
        task = task[:request.start()]
    variables = set(re.findall(r"[A-Za-z]", task))
    if len(variables) != 1 or task.count("=") != 1:
        return None
    variable = variables.pop()
    if any(match and match[1] is not None and match[1] != variable for match in (prefix, request)):
        return None
    sides = [part.strip() for part in task.translate(SYMBOLS).split("=")]
    sides = [re.sub(rf"(?<=[0-9)])\s*(?=[{re.escape(variable)}(])", "*", part) for part in sides]

    lines = essay.strip().splitlines()
    value = answer_text(lines[-1]).rstrip(".").strip() if lines else ""
    if "=" in value:
        name, _, value = value.partition("=")
        if name.strip() != variable:
            return None
        value = value.strip()
    elif len(lines) != 1:
        return None
    if not NUMERIC_ANSWER.fullmatch(value):
        return None
    try:
        (left_coefficient, left_constant), (right_coefficient, right_constant) = (
            evaluate(parse_expression(side, variable), side, variable) for side in sides
        )
        coefficient = left_coefficient - right_coefficient
        if not coefficient:
            return None
        expected = (right_constant - left_constant) / coefficient
        _, submitted = evaluate(parse_expression(value), value)
    except (SyntaxError, ValueError, ZeroDivisionError):
        return None
    return variable, expected, submitted


def grade_calculation(prompt: str, rubric: list[dict], essay: str) -> dict | None:
    if len(rubric) != 1:
        return None
    criterion = rubric[0]
    name = " ".join(criterion["criterion"].casefold().split()).rstrip(".:")
    if name not in CORRECTNESS_CRITERIA:
        return None

    if checked := check_arithmetic(prompt, essay):
        expected, submitted = checked
        correct = all(value == expected for value in submitted)
        feedback = f"Giá trị của phép tính trong đề là {expected}."
        if len(set(submitted)) > 1:
            feedback = f"Các vế trong bài làm có giá trị khác nhau. {feedback}"
    elif equation := check_equation(prompt, essay):
        variable, expected, submitted_value = equation
        correct = submitted_value == expected
        feedback = f"Nghiệm của phương trình là {variable} = {expected}."
    else:
        return None
    return {
        "criterion": criterion["criterion"],
        "score": criterion["max"] if correct else 0.0,
        "max": criterion["max"],
        "quote": essay.strip()[:300],
        "feedback": feedback,
    }
