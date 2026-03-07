import re
from html import unescape
from typing import Any, Dict, List, Optional, Tuple

_ALLOWED_TOKENS = {
    "firstName",
    "lastName",
    "fullName",
    "email",
    "company",
    "title",
    "industry",
    "location",
    "unsubscribeUrl",
    "viewInBrowserUrl",
    "trackingPixel",
    "campaignName",
}

_TOKEN_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
_IF_RE = re.compile(
    r"\{\{#if\s+([a-zA-Z0-9_]+)\}\}(.*?)"
    r"(?:\{\{else\}\}(.*?))?\{\{/if\}\}",
    re.DOTALL,
)


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _sanitize_preview_html(html: str) -> str:
    # Lightweight sanitization for preview only.
    html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r"\son[a-z]+\s*=\s*(['\"]).*?\1", "", html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r"\sjavascript:\s*", "", html, flags=re.IGNORECASE)
    return html


def html_to_text(html: str) -> str:
    text = re.sub(r"<\s*br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"<\s*/\s*p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _replace_conditionals(template: str, vars_map: Dict[str, Any]) -> str:
    def repl(match: re.Match[str]) -> str:
        var_name = match.group(1)
        if_block = match.group(2) or ""
        else_block = match.group(3) or ""
        return if_block if vars_map.get(var_name) else else_block

    prev = None
    out = template
    while prev != out:
        prev = out
        out = _IF_RE.sub(repl, out)
    return out


def _parse_token_expr(expr: str) -> Tuple[str, Optional[str]]:
    if "|" not in expr:
        return expr.strip(), None
    left, right = expr.split("|", 1)
    token = left.strip()
    fallback_raw = right.strip()
    if (fallback_raw.startswith('"') and fallback_raw.endswith('"')) or (
        fallback_raw.startswith("'") and fallback_raw.endswith("'")
    ):
        fallback_raw = fallback_raw[1:-1]
    return token, fallback_raw


def extract_unknown_tokens(text: str) -> List[str]:
    unknown: List[str] = []
    for match in _TOKEN_RE.finditer(text or ""):
        expr = match.group(1).strip()
        if expr.startswith("#if") or expr in {"else", "/if"}:
            continue
        token, _fallback = _parse_token_expr(expr)
        if token and token not in _ALLOWED_TOKENS and token not in unknown:
            unknown.append(token)
    return unknown


def render_text(template: str, vars_map: Dict[str, Any]) -> str:
    rendered = _replace_conditionals(template or "", vars_map)

    def token_repl(match: re.Match[str]) -> str:
        token_expr = match.group(1).strip()
        token, fallback = _parse_token_expr(token_expr)
        value = vars_map.get(token)
        if value in (None, ""):
            return fallback or ""
        return _stringify(value)

    return _TOKEN_RE.sub(token_repl, rendered)


def find_empty_links(html: str) -> List[str]:
    problems: List[str] = []
    for m in re.finditer(r"<a\b[^>]*href\s*=\s*(['\"])(.*?)\1[^>]*>", html or "", flags=re.IGNORECASE | re.DOTALL):
        href = (m.group(2) or "").strip()
        if href == "":
            problems.append("Anchor tag has empty href")
    return problems


def validate_rendered_output(subject: str, html: str, from_email: Optional[str]) -> Dict[str, List[str]]:
    errors: List[str] = []
    warnings: List[str] = []

    if not (subject or "").strip():
        errors.append("Subject is required")
    if from_email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", from_email.strip()):
        errors.append("From email is invalid")
    if "{{unsubscribeUrl}}" not in (html or ""):
        errors.append("Missing required token: {{unsubscribeUrl}}")

    for item in find_empty_links(html or ""):
        warnings.append(item)

    unresolved = sorted(set(re.findall(r"\{\{[^{}]+\}\}", subject + "\n" + (html or ""))))
    if unresolved:
        warnings.append(f"Unresolved tokens after render: {', '.join(unresolved)}")

    for token in extract_unknown_tokens(subject + "\n" + (html or "")):
        warnings.append(f"Unknown token: {token}")

    return {"errors": errors, "warnings": warnings}


def render_template_bundle(template: Dict[str, Any], vars_map: Dict[str, Any]) -> Dict[str, Any]:
    subject_tmpl = template.get("subject") or ""
    preheader_tmpl = template.get("preheader") or ""
    html_tmpl = template.get("html_body") or ""
    text_tmpl = template.get("text_body") or ""

    subject = render_text(subject_tmpl, vars_map)
    preheader = render_text(preheader_tmpl, vars_map)
    html = render_text(html_tmpl, vars_map)
    text = render_text(text_tmpl, vars_map) if text_tmpl.strip() else html_to_text(html)

    validation = validate_rendered_output(subject_tmpl, html_tmpl, template.get("from_email"))
    post_validation = validate_rendered_output(subject, html, template.get("from_email"))

    return {
        "subject": subject,
        "preheader": preheader,
        "html": html,
        "text": text,
        "sanitized_html": _sanitize_preview_html(html),
        "warnings": [*validation.get("warnings", []), *post_validation.get("warnings", [])],
        "errors": [*validation.get("errors", []), *post_validation.get("errors", [])],
    }
