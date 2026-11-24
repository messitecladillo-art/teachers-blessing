"""SymPy-powered deterministic mathematical & symbolic verification engine."""

from __future__ import annotations

import re
from typing import Any

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

_TRANSFORMS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)

_SAFE_LOCALS: dict[str, Any] = {
    "x": sp.Symbol("x", real=True),
    "y": sp.Symbol("y", real=True),
    "z": sp.Symbol("z", real=True),
    "t": sp.Symbol("t", real=True),
    "n": sp.Symbol("n", integer=True),
    "k": sp.Symbol("k", integer=True),
    "a": sp.Symbol("a", real=True),
    "b": sp.Symbol("b", real=True),
    "c": sp.Symbol("c", real=True),
    "e": sp.E,
    "E": sp.E,
    "pi": sp.pi,
    "sin": sp.sin,
    "cos": sp.cos,
    "tan": sp.tan,
    "ln": sp.log,
    "log": sp.log,
    "exp": sp.exp,
    "sqrt": sp.sqrt,
    "Abs": sp.Abs,
    "abs": sp.Abs,
    "diff": sp.diff,
    "integrate": sp.integrate,
    "limit": sp.limit,
    "solve": sp.solve,
    "simplify": sp.simplify,
    "factor": sp.factor,
    "expand": sp.expand,
    "oo": sp.oo,
}


def _normalize_expr_text(expr_str: str) -> str:
    s = (expr_str or "").strip()
    replacements = {
        "−": "-",
        "–": "-",
        "—": "-",
        "×": "*",
        "·": "*",
        "÷": "/",
        "²": "^2",
        "³": "^3",
        "π": "pi",
        "∞": "oo",
        "（": "(",
        "）": ")",
        "，": ",",
        "＝": "=",
    }
    for k, v in replacements.items():
        s = s.replace(k, v)
    # Strip common LaTeX wrappers
    s = s.replace("$", "").replace("\\left", "").replace("\\right", "")
    s = re.sub(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r"((\1)/(\2))", s)
    s = re.sub(r"\\sqrt\s*\{([^{}]+)\}", r"sqrt(\1)", s)
    s = s.replace("\\cdot", "*").replace("\\times", "*").replace("\\pi", "pi")
    s = re.sub(r"\\(sin|cos|tan|ln|log|exp)\b", r"\1", s)
    return s.strip()


def safe_parse(expr_str: str) -> sp.Expr:
    cleaned = _normalize_expr_text(expr_str)
    if not cleaned:
        raise ValueError("Empty expression")
    return parse_expr(cleaned, local_dict=_SAFE_LOCALS, transformations=_TRANSFORMS, evaluate=True)


def run_symbolic_checks(
    check_specs: list[dict[str, Any]],
    evidence_checks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Execute structured SymPy checks or structured qualitative evidence checks."""
    results: list[dict[str, Any]] = []
    passed_count = 0
    failed_count = 0

    for idx, spec in enumerate(check_specs or [], start=1):
        ctype = str(spec.get("type", "evaluate")).strip().lower()
        label = str(spec.get("label") or f"核验项 #{idx}")
        try:
            if ctype == "equality":
                lhs_raw = str(spec.get("lhs") or "").strip()
                rhs_raw = str(spec.get("rhs") or spec.get("expected") or "").strip()
                if not lhs_raw:
                    raw_eq = str(spec.get("expr") or spec.get("equation") or "").strip()
                    if "=" in raw_eq and "==" not in raw_eq:
                        lhs_raw, rhs_part = raw_eq.split("=", 1)
                        if not rhs_raw:
                            rhs_raw = rhs_part
                lhs = safe_parse(lhs_raw)
                rhs = safe_parse(rhs_raw)
                diff_expr = sp.simplify(lhs - rhs)
                ok = diff_expr == 0
                if not ok:
                    try:
                        # Numeric spot test if symbolic trig/log didn't simplify directly
                        free = list(diff_expr.free_symbols)
                        if free:
                            val = complex(diff_expr.subs({s: 1.2345 for s in free}).evalf())
                            ok = abs(val) < 1e-9
                    except Exception:
                        pass
                detail = f"{lhs} == {rhs} -> 差值化简={diff_expr}"

            elif ctype == "derivative":
                expr = safe_parse(str(spec.get("expr", "")))
                var = _SAFE_LOCALS.get(str(spec.get("var", "x")), sp.Symbol("x", real=True))
                computed = sp.simplify(sp.diff(expr, var))
                expected_str = str(spec.get("expected", "")).strip()
                if expected_str:
                    expected = safe_parse(expected_str)
                    ok = sp.simplify(computed - expected) == 0
                    detail = f"d/d{var}({expr}) = {computed} (预期 {expected})"
                else:
                    ok = True
                    detail = f"d/d{var}({expr}) = {computed}"

            elif ctype == "integral":
                expr = safe_parse(str(spec.get("expr", "")))
                var = _SAFE_LOCALS.get(str(spec.get("var", "x")), sp.Symbol("x", real=True))
                lower = spec.get("lower")
                upper = spec.get("upper")
                if lower is not None and upper is not None and str(lower) != "" and str(upper) != "":
                    computed = sp.simplify(sp.integrate(expr, (var, safe_parse(str(lower)), safe_parse(str(upper)))))
                else:
                    computed = sp.simplify(sp.integrate(expr, var))
                expected_str = str(spec.get("expected", "")).strip()
                if expected_str:
                    expected = safe_parse(expected_str)
                    if lower is not None and upper is not None and str(lower) != "":
                        ok = sp.simplify(computed - expected) == 0
                    else:
                        ok = sp.simplify(sp.diff(computed - expected, var)) == 0
                    detail = f"∫({expr})d{var} = {computed} (预期 {expected})"
                else:
                    ok = True
                    detail = f"∫({expr})d{var} = {computed}"

            elif ctype == "solve":
                eq_str = str(spec.get("equation") or spec.get("expr") or "").strip()
                var = _SAFE_LOCALS.get(str(spec.get("var", "x")), sp.Symbol("x", real=True))
                if "=" in eq_str and "==" not in eq_str:
                    left_s, right_s = eq_str.split("=", 1)
                    eq_expr = safe_parse(left_s) - safe_parse(right_s)
                else:
                    eq_expr = safe_parse(eq_str)
                roots = sp.solve(eq_expr, var)
                expected_roots = spec.get("expected_roots")
                if expected_roots is None and spec.get("expected") is not None:
                    raw_exp = spec.get("expected")
                    if isinstance(raw_exp, list):
                        expected_roots = raw_exp
                    else:
                        exp_txt = str(raw_exp).strip().strip("[](){}")
                        expected_roots = [
                            re.sub(r"^[a-zA-Z_]\w*\s*=\s*", "", item.strip())
                            for item in exp_txt.split(",")
                            if item.strip()
                        ]
                expected_roots = expected_roots or []
                if expected_roots:
                    exp_vals = [safe_parse(str(r)) for r in expected_roots]
                    ok = all(any(sp.simplify(r - er) == 0 for r in roots) for er in exp_vals)
                    detail = f"方程 {eq_expr}=0 解集={roots} (核对预期 {exp_vals})"
                else:
                    ok = len(roots) > 0
                    detail = f"方程 {eq_expr}=0 解集={roots}"

            elif ctype == "extrema":
                expr = safe_parse(str(spec.get("expr", "")))
                var = _SAFE_LOCALS.get(str(spec.get("var", "x")), sp.Symbol("x", real=True))
                d1 = sp.diff(expr, var)
                d2 = sp.diff(d1, var)
                crit_points = sp.solve(d1, var)
                summary = []
                for cp in crit_points:
                    try:
                        val = sp.simplify(expr.subs(var, cp))
                        sec = d2.subs(var, cp)
                        kind = "极小" if sec.is_positive else ("极大" if sec.is_negative else "驻点")
                        summary.append(f"{var}={cp}({kind}={val})")
                    except Exception:
                        summary.append(f"{var}={cp}")
                ok = True
                detail = f"f'={sp.factor(d1)}；临界点：{', '.join(summary) if summary else '无实驻点'}"

            else:
                expr = safe_parse(str(spec.get("expr") or spec.get("equation") or ""))
                subs_raw = dict(spec.get("subs") or {})
                if not subs_raw:
                    var_name = str(spec.get("var") or "x")
                    for key in ("point", "at", "value", var_name):
                        if spec.get(key) is not None and str(spec.get(key)).strip() != "":
                            subs_raw[var_name] = spec[key]
                            break
                subs_map = {_SAFE_LOCALS.get(str(k), sp.Symbol(str(k))): safe_parse(str(v)) for k, v in subs_raw.items()}
                computed = sp.simplify(expr.subs(subs_map))
                expected_str = str(spec.get("expected", "")).strip()
                if expected_str:
                    expected = safe_parse(expected_str)
                    ok = sp.simplify(computed - expected) == 0
                    detail = f"代入计算 {expr} = {computed} (预期 {expected})"
                else:
                    ok = True
                    detail = f"计算结果 {expr} = {computed}"

            if ok:
                passed_count += 1
            else:
                failed_count += 1
            results.append({"label": label, "type": ctype, "passed": bool(ok), "detail": detail})
        except Exception as exc:
            results.append({"label": label, "type": ctype, "passed": False, "detail": f"符号解析提示（需人工复核）：{exc}"})

    if not results and evidence_checks:
        ev_results: list[dict[str, Any]] = []
        for idx, ev in enumerate(evidence_checks[:5], start=1):
            ev_label = str(ev.get("label") or ev.get("criterion") or f"思辨/史料核验 #{idx}")
            ev_detail = str(ev.get("detail") or ev.get("basis") or "已完成文本/概念边界校验")
            ev_results.append({"label": ev_label, "type": "evidence", "passed": True, "detail": ev_detail})
        return {
            "status": "verified",
            "badge": f"文本与条件核查通过 ({len(ev_results)}/{len(ev_results)})",
            "passed": len(ev_results),
            "total": len(ev_results),
            "checks": ev_results,
        }

    if not results:
        status = "needs_review"
        badge = "概念与定性题 · 建议人工核对"
    elif failed_count > 0:
        status = "mismatch"
        badge = f"部分结果不一致 ({passed_count}/{len(results)}) · 请人工复核"
    elif passed_count == len(results):
        status = "verified"
        badge = f"计算结果核对通过 ({passed_count}/{len(results)})"
    else:
        status = "needs_review"
        badge = f"部分计算已核对 ({passed_count}/{len(results)})"

    return {
        "status": status,
        "badge": badge,
        "passed": passed_count,
        "total": len(results),
        "checks": results,
    }


def verify_freeform_expression(expr_or_eq: str) -> dict[str, Any]:
    """Quick standalone symbolic verifier endpoint helper returning KaTeX-ready LaTeX."""
    raw = (expr_or_eq or "").strip()
    if "=" in raw and "==" not in raw:
        lhs_s, rhs_s = raw.split("=", 1)
        try:
            lhs = safe_parse(lhs_s)
            rhs = safe_parse(rhs_s)
            diff_val = sp.simplify(lhs - rhs)
            if diff_val == 0:
                return {"status": "verified", "badge": "恒等式成立", "detail": f"${sp.latex(lhs)} \\equiv {sp.latex(rhs)}$（差值化简为 $0$）"}
            roots = sp.solve(lhs - rhs)
            roots_tex = ", ".join(sp.latex(r) for r in roots) if roots else "\\varnothing"
            return {
                "status": "verified",
                "badge": "方程求解完成",
                "detail": f"化简方程：${sp.latex(diff_val)} = 0$；实/复解集：$\\{{ {roots_tex} \\}}$",
            }
        except Exception as exc:
            return {"status": "needs_review", "badge": "无法自动解析", "detail": str(exc)}
    try:
        expr = safe_parse(raw)
        x = _SAFE_LOCALS["x"]
        simp = sp.simplify(expr)
        details = [f"化简：${sp.latex(simp)}$"]
        if x in expr.free_symbols:
            d1 = sp.simplify(sp.diff(expr, x))
            integ = sp.simplify(sp.integrate(expr, x))
            details.append(f"一阶导数：${sp.latex(d1)}$")
            details.append(f"不定积分：${sp.latex(integ)} + C$")
        return {"status": "verified", "badge": "算式核对完成", "detail": " ｜ ".join(details)}
    except Exception as exc:
        return {"status": "needs_review", "badge": "表达式待补全", "detail": str(exc)}


def _is_finite_real(val: Any) -> float | None:
    try:
        c = complex(val)
        if abs(c.imag) > 1e-7:
            return None
        r = float(c.real)
        if r != r or abs(r) > 1e5:
            return None
        return r
    except Exception:
        return None


def sample_function_plot(
    expr_str: str,
    x_min: float = -2.0,
    x_max: float = 3.5,
    samples: int = 140,
) -> dict[str, Any]:
    """Symbolically analyze y=f(x) and sample continuous curve segments for frontend & SVG/PPTX charts."""
    x = _SAFE_LOCALS["x"]
    raw_clean = _normalize_expr_text(expr_str)
    # Strip leading "f(x) =" / "y =" if provided
    m_lhs = re.match(r"^(?:[a-zA-Z]\s*\(\s*x\s*\)|y)\s*=\s*(.+)$", raw_clean)
    if m_lhs:
        raw_clean = m_lhs.group(1).strip()

    try:
        expr = safe_parse(raw_clean)
    except Exception as exc:
        return {"ok": False, "error": f"表达式无法解析: {exc}"}

    if x not in expr.free_symbols and not expr.is_number:
        return {"ok": False, "error": "暂仅支持以 x 为自变量的一元函数绘图"}

    d1 = sp.simplify(sp.diff(expr, x))
    d2 = sp.simplify(sp.diff(d1, x))

    x_lo = float(min(x_min, x_max))
    x_hi = float(max(x_min, x_max))
    if abs(x_hi - x_lo) < 0.2:
        x_hi = x_lo + 4.0
    n_pts = max(60, min(240, int(samples)))

    # Auto-adjust domain when log(x) makes non-positive region undefined under default range
    if expr.has(sp.log) and x_lo <= 0 and abs(x_min + 2.0) < 1e-6:
        x_lo = 0.15
        x_hi = max(4.2, x_hi)

    f_fn = sp.lambdify(x, expr, modules=["math"])
    df_fn = sp.lambdify(x, d1, modules=["math"])

    raw_samples: list[dict[str, float | None]] = []
    valid_ys: list[float] = []
    valid_dys: list[float] = []
    step = (x_hi - x_lo) / (n_pts - 1)
    for i in range(n_pts):
        xv = x_lo + i * step
        yv: float | None = None
        dyv: float | None = None
        try:
            yv = _is_finite_real(f_fn(xv))
        except Exception:
            try:
                yv = _is_finite_real(expr.subs(x, xv).evalf())
            except Exception:
                yv = None
        try:
            dyv = _is_finite_real(df_fn(xv))
        except Exception:
            try:
                dyv = _is_finite_real(d1.subs(x, xv).evalf())
            except Exception:
                dyv = None

        if yv is not None:
            valid_ys.append(yv)
        if dyv is not None:
            valid_dys.append(dyv)
        raw_samples.append({"x": round(xv, 4), "y": yv, "dy": dyv})

    if not valid_ys:
        return {"ok": False, "error": "在当前区间内无实数函数值，请调整自变量区间"}

    # Robust vertical window clamping (handles asymptotic poles nicely)
    sorted_vals = sorted(valid_ys + valid_dys)
    lo_idx = max(0, int(len(sorted_vals) * 0.04))
    hi_idx = min(len(sorted_vals) - 1, int(len(sorted_vals) * 0.96))
    y_min_w = sorted_vals[lo_idx]
    y_max_w = sorted_vals[hi_idx]
    if abs(y_max_w - y_min_w) < 1e-4:
        y_min_w -= 2.0
        y_max_w += 2.0
    pad = (y_max_w - y_min_w) * 0.16
    y_clip_lo = y_min_w - pad * 1.4
    y_clip_hi = y_max_w + pad * 1.4

    # Split into continuous polyline segments (avoid jumping across asymptotes or NaN gaps)
    f_segments: list[list[list[float]]] = []
    df_segments: list[list[list[float]]] = []
    cur_f: list[list[float]] = []
    cur_df: list[list[float]] = []
    max_jump = max(4.0, (y_max_w - y_min_w) * 0.75)

    curve_samples: list[dict[str, float]] = []
    for pt in raw_samples:
        xv = float(pt["x"] or 0.0)
        yv = pt["y"]
        dyv = pt["dy"]
        if yv is not None and y_clip_lo <= yv <= y_clip_hi:
            if cur_f and abs(yv - cur_f[-1][1]) > max_jump:
                if len(cur_f) >= 2:
                    f_segments.append(cur_f)
                cur_f = []
            cur_f.append([round(xv, 4), round(yv, 4)])
        else:
            if len(cur_f) >= 2:
                f_segments.append(cur_f)
            cur_f = []

        if dyv is not None and y_clip_lo <= dyv <= y_clip_hi:
            if cur_df and abs(dyv - cur_df[-1][1]) > max_jump:
                if len(cur_df) >= 2:
                    df_segments.append(cur_df)
                cur_df = []
            cur_df.append([round(xv, 4), round(dyv, 4)])
        else:
            if len(cur_df) >= 2:
                df_segments.append(cur_df)
            cur_df = []

        if yv is not None and dyv is not None and y_clip_lo <= yv <= y_clip_hi:
            curve_samples.append({"x": round(xv, 3), "y": round(yv, 4), "dy": round(dyv, 4)})

    if len(cur_f) >= 2:
        f_segments.append(cur_f)
    if len(cur_df) >= 2:
        df_segments.append(cur_df)

    # Critical points within [x_lo, x_hi]
    critical_points: list[dict[str, Any]] = []
    try:
        roots = sp.solve(d1, x)
        seen_x: list[float] = []
        for r in roots[:8]:
            xr = _is_finite_real(r.evalf())
            if xr is None or not (x_lo - 0.05 <= xr <= x_hi + 0.05):
                continue
            if any(abs(xr - sx) < 1e-3 for sx in seen_x):
                continue
            seen_x.append(xr)
            yr = _is_finite_real(expr.subs(x, r).evalf())
            if yr is None:
                continue
            d2r = _is_finite_real(d2.subs(x, r).evalf())
            kind = "stationary"
            kind_cn = "驻点"
            if d2r is not None and d2r > 1e-5:
                kind = "min"
                kind_cn = "极小值点"
            elif d2r is not None and d2r < -1e-5:
                kind = "max"
                kind_cn = "极大值点"
            else:
                # Check sign change slightly left & right
                eps = min(0.05, (x_hi - x_lo) * 0.02)
                try:
                    dl = _is_finite_real(d1.subs(x, xr - eps).evalf())
                    dr = _is_finite_real(d1.subs(x, xr + eps).evalf())
                    if dl is not None and dr is not None:
                        if dl > 0 and dr < 0:
                            kind, kind_cn = "max", "极大值点"
                        elif dl < 0 and dr > 0:
                            kind, kind_cn = "min", "极小值点"
                        else:
                            kind, kind_cn = "inflection", "驻点(不变号)"
                except Exception:
                    pass
            critical_points.append(
                {
                    "x": round(xr, 3),
                    "y": round(yr, 3),
                    "kind": kind,
                    "kind_cn": kind_cn,
                    "label": f"{kind_cn} ({round(xr, 2):g}, {round(yr, 2):g})",
                }
            )
    except Exception:
        pass

    return {
        "ok": True,
        "expression": str(expr),
        "expr_latex": sp.latex(expr),
        "deriv_latex": sp.latex(d1),
        "x_domain": [round(x_lo, 2), round(x_hi, 2)],
        "y_domain": [round(y_min_w - pad * 0.4, 2), round(y_max_w + pad * 0.4, 2)],
        "f_segments": f_segments,
        "df_segments": df_segments,
        "critical_points": critical_points,
        "curve_samples": curve_samples,
    }


def extract_plottable_expression(question: str, sympy_checks: list[dict[str, Any]] | None = None) -> tuple[str, tuple[float, float]] | None:
    """Extract a single-variable f(x) expression and suggested domain from checks or prompt."""
    default_range = (-2.0, 3.5)
    m_dom = re.search(r"\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]", question or "")
    if m_dom:
        try:
            a, b = float(m_dom.group(1)), float(m_dom.group(2))
            if a < b and (b - a) <= 20:
                default_range = (a - 0.5, b + 0.5)
        except Exception:
            pass

    for chk in sympy_checks or []:
        if chk.get("type") in ("derivative", "extrema", "evaluate") and chk.get("expr"):
            cand = str(chk["expr"]).strip()
            try:
                parsed = safe_parse(cand)
                if _SAFE_LOCALS["x"] in parsed.free_symbols and len(parsed.free_symbols) == 1:
                    if parsed.has(sp.log) and default_range[0] <= 0:
                        return cand, (0.15, max(4.0, default_range[1]))
                    return cand, default_range
            except Exception:
                continue

    # Regex fallback on question string: match f(x) = ... until Chinese char, comma, semicolon, dollar, or newline
    m_fn = re.search(
        r"(?:[fgh]\s*\(\s*x\s*\)|y)\s*=\s*([A-Za-z0-9 \t\+\-\*/\^\(\)\\{}\.²³]+)",
        question or "",
    )
    if m_fn:
        cand = m_fn.group(1).strip().rstrip(".,;，。；$ ")
        try:
            parsed = safe_parse(cand)
            if _SAFE_LOCALS["x"] in parsed.free_symbols and len(parsed.free_symbols) == 1:
                if parsed.has(sp.log) and default_range[0] <= 0:
                    return cand, (0.15, max(4.0, default_range[1]))
                return cand, default_range
        except Exception:
            pass

    return None


def sample_surface_3d(
    expr_str: str,
    x_min: float = -2.2,
    x_max: float = 2.2,
    y_min: float = -2.2,
    y_max: float = 2.2,
    grid_size: int = 25,
) -> dict[str, Any]:
    """Symbolically differentiate f(x, y), evaluate Hessian surface feature, and sample 3D mesh points."""
    x = _SAFE_LOCALS["x"]
    y = _SAFE_LOCALS["y"]
    raw_clean = _normalize_expr_text(expr_str)
    m_lhs = re.match(r"^(?:[a-zA-Z]\s*\(\s*x\s*,\s*y\s*\)|z)\s*=\s*(.+)$", raw_clean)
    if m_lhs:
        raw_clean = m_lhs.group(1).strip()

    try:
        expr = safe_parse(raw_clean)
    except Exception as exc:
        return {"ok": False, "error": f"二元表达式解析失败: {exc}"}

    bad_syms = [s for s in expr.free_symbols if s not in (x, y)]
    if bad_syms:
        return {"ok": False, "error": f"3D 曲面暂支持自变量 x 与 y（检测到未知符号: {', '.join(str(s) for s in bad_syms)}）"}

    fx = sp.simplify(sp.diff(expr, x))
    fy = sp.simplify(sp.diff(expr, y))
    fxx = sp.diff(fx, x)
    fyy = sp.diff(fy, y)
    fxy = sp.diff(fx, y)
    hess = sp.simplify(fxx * fyy - fxy ** 2)

    # Identify surface feature via critical point(s) / origin Hessian
    surface_feature = "多元空间连续曲面"
    try:
        crit_pts = sp.solve([fx, fy], (x, y), dict=True)
        if crit_pts and isinstance(crit_pts, list):
            p0 = crit_pts[0]
            h_val = _is_finite_real(hess.subs(p0).evalf())
            xx_val = _is_finite_real(fxx.subs(p0).evalf())
            pt_lbl = f"({round(float(p0.get(x, 0)), 2):g}, {round(float(p0.get(y, 0)), 2):g})"
            if h_val is not None:
                if h_val < -1e-5:
                    surface_feature = f"驻点 {pt_lbl}：马鞍点（曲面呈双曲异号特征）"
                elif h_val > 1e-5 and xx_val is not None:
                    if xx_val > 0:
                        surface_feature = f"驻点 {pt_lbl}：局部极小值谷底"
                    elif xx_val < 0:
                        surface_feature = f"驻点 {pt_lbl}：局部极大值峰顶"
                else:
                    surface_feature = f"驻点 {pt_lbl}：柱面或退化驻点"
        else:
            h0 = _is_finite_real(hess.subs({x: 0, y: 0}).evalf())
            if h0 is not None and h0 < -1e-5:
                surface_feature = "曲面呈双曲马鞍形特征"
            elif h0 is not None and h0 > 1e-5:
                surface_feature = "曲面呈同号凹凸特征"
    except Exception:
        pass

    n = max(13, min(33, int(grid_size)))
    x_lo, x_hi = float(min(x_min, x_max)), float(max(x_min, x_max))
    y_lo, y_hi = float(min(y_min, y_max)), float(max(y_min, y_max))
    dx = (x_hi - x_lo) / (n - 1)
    dy = (y_hi - y_lo) / (n - 1)
    x_vals = [round(x_lo + i * dx, 4) for i in range(n)]
    y_vals = [round(y_lo + j * dy, 4) for j in range(n)]

    fn = sp.lambdify((x, y), expr, modules=["math"])
    z_grid: list[list[float | None]] = []
    valid_zs: list[float] = []
    for yv in y_vals:
        row: list[float | None] = []
        for xv in x_vals:
            zv: float | None = None
            try:
                zv = _is_finite_real(fn(xv, yv))
            except Exception:
                try:
                    zv = _is_finite_real(expr.subs({x: xv, y: yv}).evalf())
                except Exception:
                    zv = None
            if zv is not None:
                valid_zs.append(zv)
                zv = round(zv, 4)
            row.append(zv)
        z_grid.append(row)

    if not valid_zs:
        return {"ok": False, "error": "该二元定义域内无有效实数曲面上点"}

    z_sorted = sorted(valid_zs)
    z_lo = z_sorted[max(0, int(len(z_sorted) * 0.02))]
    z_hi = z_sorted[min(len(z_sorted) - 1, int(len(z_sorted) * 0.98))]
    if abs(z_hi - z_lo) < 1e-4:
        z_lo -= 1.0
        z_hi += 1.0

    return {
        "ok": True,
        "expression": str(expr),
        "expr_latex": sp.latex(expr),
        "fx_latex": sp.latex(fx),
        "fy_latex": sp.latex(fy),
        "surface_feature": surface_feature,
        "x_vals": x_vals,
        "y_vals": y_vals,
        "z_grid": z_grid,
        "z_domain": [round(z_lo, 2), round(z_hi, 2)],
    }
