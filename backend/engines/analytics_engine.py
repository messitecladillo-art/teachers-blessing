"""Privacy-preserving PII desensitization, deterministic educational statistics, and vector chart generator."""

from __future__ import annotations

import csv
import hashlib
import io
import math
import re
import statistics
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from core.config import EXPORTS_DIR

# Configure Chinese-friendly font stack for Matplotlib
plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

# Built-in realistic 48-student senior high math test CSV (with simulated PII fields to demonstrate local redaction)
SAMPLE_CSV_CONTENT = """学号,姓名,班级,手机号,总分,Q1_导数几何意义(10分),Q2_切线方程(10分),Q3_单调区间求解(15分),Q4_极值与驻点辨析(15分),Q5_含参单调性讨论(25分),Q6_极值最值综合压轴(25分)
20240201,张晨曦,高二(3)班,13812340001,94,10,10,15,15,23,21
20240202,李明哲,高二(3)班,13812340002,88,10,9,14,13,22,20
20240203,王思涵,高二(3)班,13812340003,96,10,10,15,15,24,22
20240204,赵宇航,高二(3)班,13812340004,72,9,8,12,10,18,15
20240205,陈嘉怡,高二(3)班,13812340005,81,10,9,13,12,20,17
20240206,刘子轩,高二(3)班,13812340006,64,8,7,11,9,16,13
20240207,周若琳,高二(3)班,13812340007,91,10,10,14,14,22,21
20240208,吴浩然,高二(3)班,13812340008,58,7,6,10,8,15,12
20240209,郑雨桐,高二(3)班,13812340009,77,9,9,13,12,19,15
20240210,孙泽楷,高二(3)班,13812340010,85,10,9,14,13,21,18
20240211,马语嫣,高二(3)班,13812340011,69,8,8,12,10,17,14
20240212,朱天宇,高二(3)班,13812340012,53,7,6,9,7,14,10
20240213,胡欣妍,高二(3)班,13812340013,89,10,10,14,14,21,20
20240214,林志远,高二(3)班,13812340014,74,9,8,12,11,19,15
20240215,郭佳琪,高二(3)班,13812340015,92,10,10,15,14,22,21
20240216,何俊杰,高二(3)班,13812340016,61,8,7,10,9,15,12
20240217,高雅静,高二(3)班,13812340017,83,10,9,14,13,20,17
20240218,罗文博,高二(3)班,13812340018,47,6,5,8,7,12,9
20240219,梁诗琪,高二(3)班,13812340019,79,9,9,13,12,20,16
20240220,谢奕辰,高二(3)班,13812340020,86,10,9,14,14,21,18
20240221,宋安琪,高二(3)班,13812340021,67,8,8,11,10,16,14
20240222,唐启明,高二(3)班,13812340022,76,9,8,13,12,19,15
20240223,许婉清,高二(3)班,13812340023,95,10,10,15,15,23,22
20240224,韩景烁,高二(3)班,13812340024,55,7,6,9,8,14,11
20240225,冯雪儿,高二(4)班,13956780025,84,10,9,14,13,21,17
20240226,邓思源,高二(4)班,13956780026,71,9,8,12,11,17,14
20240227,曹韵诗,高二(4)班,13956780027,90,10,10,14,14,22,20
20240228,彭浩轩,高二(4)班,13956780028,63,8,7,10,9,16,13
20240229,曾可欣,高二(4)班,13956780029,78,9,9,13,12,19,16
20240230,萧景行,高二(4)班,13956780030,44,6,5,8,6,11,8
20240231,田雨晴,高二(4)班,13956780031,87,10,9,14,14,21,19
20240232,董瑞霖,高二(4)班,13956780032,68,8,8,12,10,17,13
20240233,袁紫萱,高二(4)班,13956780033,93,10,10,15,15,22,21
20240234,潘宇辰,高二(4)班,13956780034,59,7,7,10,9,14,12
20240235,于舒雅,高二(4)班,13956780035,82,10,9,13,13,20,17
20240236,蒋博文,高二(4)班,13956780036,75,9,8,13,11,19,15
20240237,蔡依琳,高二(4)班,13956780037,66,8,8,11,10,16,13
20240238,余沐阳,高二(4)班,13956780038,89,10,10,14,14,21,20
20240239,杜若溪,高二(4)班,13956780039,51,7,6,9,7,13,9
20240240,叶承泽,高二(4)班,13956780040,80,9,9,14,12,20,16
20240241,程思敏,高二(4)班,13956780041,73,9,8,12,11,18,15
20240242,苏逸凡,高二(4)班,13956780042,97,10,10,15,15,24,23
20240243,魏知夏,高二(4)班,13956780043,62,8,7,11,9,15,12
20240244,吕昊天,高二(4)班,13956780044,70,9,8,12,10,17,14
20240245,丁若雪,高二(4)班,13956780045,86,10,9,14,14,21,18
20240246,任子墨,高二(4)班,13956780046,56,7,6,10,8,14,11
20240247,沈清欢,高二(4)班,13956780047,91,10,10,15,14,22,20
20240248,姚明远,高二(4)班,13956780048,77,9,9,13,12,18,16
"""

_PII_COL_KEYWORDS = ("姓名", "name", "学号", "student_id", "id", "手机", "电话", "phone", "mobile", "身份证", "邮箱", "email")
_PHONE_RE = re.compile(r"\b1[3-9]\d{9}\b")
_IDCARD_RE = re.compile(r"\b\d{17}[\dXx]\b")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def _hash_alias(raw: str, prefix: str = "Stu") -> str:
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:6].upper()
    return f"{prefix}_{digest}"


def desensitize_csv_text(csv_text: str) -> dict[str, Any]:
    """Strip/mask PII columns and regex patterns locally before any AI model ever sees the data."""
    reader = list(csv.reader(io.StringIO(csv_text.strip())))
    if len(reader) < 2:
        raise ValueError("CSV 数据至少需要包含表头与一行学生记录。")

    headers = [h.strip() for h in reader[0]]
    rows = reader[1:]

    pii_cols: dict[int, str] = {}
    for idx, h in enumerate(headers):
        hl = h.lower()
        if any(kw in hl for kw in _PII_COL_KEYWORDS):
            pii_cols[idx] = h

    masked_headers = []
    drop_indices = set()
    for idx, h in enumerate(headers):
        hl = h.lower()
        if any(k in hl for k in ("手机", "电话", "phone", "mobile", "身份证", "邮箱", "email")):
            drop_indices.add(idx)
        elif idx in pii_cols:
            masked_headers.append("脱敏学生代号" if ("姓名" in h or "name" in hl) else "脱敏编号")
        else:
            masked_headers.append(h)

    masked_rows: list[list[str]] = []
    redacted_fields_count = 0
    sample_before: list[dict[str, str]] = []
    sample_after: list[dict[str, str]] = []

    for r_idx, row in enumerate(rows):
        if not any(cell.strip() for cell in row):
            continue
        padded = row + [""] * (len(headers) - len(row))
        if r_idx < 3:
            sample_before.append({headers[i]: padded[i] for i in range(len(headers))})

        new_row: list[str] = []
        after_dict: dict[str, str] = {}
        out_col_idx = 0
        for c_idx, val in enumerate(padded):
            if c_idx in drop_indices:
                if val.strip():
                    redacted_fields_count += 1
                continue
            v = val.strip()
            if c_idx in pii_cols:
                if "姓名" in headers[c_idx] or "name" in headers[c_idx].lower():
                    v = f"Stu_{r_idx + 1:03d}"
                else:
                    v = _hash_alias(v or str(r_idx + 1), prefix="ID")
                redacted_fields_count += 1
            else:
                if _PHONE_RE.search(v):
                    v = _PHONE_RE.sub("[已脱敏手机]", v)
                    redacted_fields_count += 1
                if _IDCARD_RE.search(v):
                    v = _IDCARD_RE.sub("[已脱敏证件]", v)
                    redacted_fields_count += 1
                if _EMAIL_RE.search(v):
                    v = _EMAIL_RE.sub("[已脱敏邮箱]", v)
                    redacted_fields_count += 1
            new_row.append(v)
            after_dict[masked_headers[out_col_idx]] = v
            out_col_idx += 1
        masked_rows.append(new_row)
        if r_idx < 3:
            sample_after.append(after_dict)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(masked_headers)
    writer.writerows(masked_rows)

    return {
        "headers": masked_headers,
        "rows": masked_rows,
        "masked_csv": buf.getvalue(),
        "student_count": len(masked_rows),
        "dropped_columns": [headers[i] for i in sorted(drop_indices)],
        "masked_columns": [headers[i] for i in sorted(pii_cols.keys()) if i not in drop_indices],
        "redacted_fields_count": redacted_fields_count,
        "sample_before": sample_before,
        "sample_after": sample_after,
    }


def _parse_full_score_from_header(col_name: str, observed_max: float) -> float:
    m = re.search(r"(\d+(?:\.\d+)?)\s*分", col_name)
    if m:
        return float(m.group(1))
    if "总分" in col_name or "score" in col_name.lower():
        return 100.0 if observed_max <= 100 else (150.0 if observed_max <= 150 else observed_max)
    return observed_max if observed_max > 0 else 10.0


def compute_deterministic_analytics(masked_data: dict[str, Any], report_id: str) -> dict[str, Any]:
    """Compute exact descriptive & psychometric statistics in Python without LLM arithmetic."""
    headers: list[str] = masked_data["headers"]
    rows: list[list[str]] = masked_data["rows"]

    numeric_cols: list[tuple[int, str, list[float]]] = []
    for col_idx, col_name in enumerate(headers):
        if "代号" in col_name or "编号" in col_name or "班级" in col_name:
            continue
        vals: list[float] = []
        parse_ok = True
        for r in rows:
            cell = r[col_idx].strip() if col_idx < len(r) else ""
            try:
                vals.append(float(cell))
            except ValueError:
                parse_ok = False
                break
        if parse_ok and vals:
            numeric_cols.append((col_idx, col_name, vals))

    if not numeric_cols:
        raise ValueError("未检测到可计算的数值成绩列，请检查 CSV 格式。")

    # Identify total score column (explicit 总分/score or highest max column)
    total_entry = None
    for entry in numeric_cols:
        if any(k in entry[1].lower() for k in ("总分", "total", "score", "成绩")):
            total_entry = entry
            break
    if total_entry is None:
        total_entry = max(numeric_cols, key=lambda e: max(e[2]))

    total_scores = total_entry[2]
    n = len(total_scores)
    sorted_scores = sorted(total_scores)
    mean_val = round(statistics.mean(total_scores), 2)
    median_val = round(statistics.median(total_scores), 2)
    std_val = round(statistics.stdev(total_scores), 2) if n > 1 else 0.0
    q25 = round(float(np.percentile(total_scores, 25)), 2)
    q75 = round(float(np.percentile(total_scores, 75)), 2)
    min_val = round(min(total_scores), 2)
    max_val = round(max(total_scores), 2)

    full_total = _parse_full_score_from_header(total_entry[1], max_val)
    pass_line = full_total * 0.6
    excellent_line = full_total * 0.85
    pass_rate = round(sum(1 for s in total_scores if s >= pass_line) / n * 100, 1)
    excellent_rate = round(sum(1 for s in total_scores if s >= excellent_line) / n * 100, 1)

    # Score distribution buckets ordered intuitively from low to high
    buckets = [
        ("<60", sum(1 for s in total_scores if s < full_total * 0.6)),
        ("60-69", sum(1 for s in total_scores if full_total * 0.6 <= s < full_total * 0.7)),
        ("70-79", sum(1 for s in total_scores if full_total * 0.7 <= s < full_total * 0.8)),
        ("80-89", sum(1 for s in total_scores if full_total * 0.8 <= s < full_total * 0.9)),
        ("90+", sum(1 for s in total_scores if s >= full_total * 0.9)),
    ]

    # Per-item mastery rate & discrimination index (top 27% vs bottom 27%)
    k27 = max(1, int(round(n * 0.27)))
    order_idx = sorted(range(n), key=lambda i: total_scores[i])
    bottom_idx = set(order_idx[:k27])
    top_idx = set(order_idx[-k27:])

    item_metrics: list[dict[str, Any]] = []
    for _, col_name, vals in numeric_cols:
        if col_name == total_entry[1]:
            continue
        full_item = _parse_full_score_from_header(col_name, max(vals))
        avg_item = statistics.mean(vals)
        mastery_pct = round((avg_item / full_item) * 100, 1) if full_item > 0 else 0.0
        top_avg = statistics.mean([vals[i] for i in top_idx]) / full_item
        bot_avg = statistics.mean([vals[i] for i in bottom_idx]) / full_item
        disc = round(top_avg - bot_avg, 3)
        item_metrics.append(
            {
                "item": col_name,
                "full_score": full_item,
                "mean_score": round(avg_item, 2),
                "mastery_pct": mastery_pct,
                "discrimination": disc,
                "status": "薄弱预警" if mastery_pct < 70 else ("良好" if mastery_pct < 85 else "掌握扎实"),
            }
        )

    # Tiered student cohorts (anonymized aliases only)
    id_col_idx = 0
    cohorts = {
        "excellence": [rows[i][id_col_idx] for i in range(n) if total_scores[i] >= excellent_line],
        "steady": [rows[i][id_col_idx] for i in range(n) if pass_line <= total_scores[i] < excellent_line],
        "attention_needed": [rows[i][id_col_idx] for i in range(n) if total_scores[i] < pass_line],
    }

    # Generate high-res chart image for DOCX embedding
    chart_path = EXPORTS_DIR / f"analytics_chart_{report_id}.png"
    _render_analytics_chart(total_scores, buckets, item_metrics, chart_path)

    return {
        "student_count": n,
        "total_column": total_entry[1],
        "full_score": full_total,
        "summary": {
            "mean": mean_val,
            "median": median_val,
            "std": std_val,
            "q25": q25,
            "q75": q75,
            "min": min_val,
            "max": max_val,
            "pass_rate": pass_rate,
            "excellent_rate": excellent_rate,
        },
        "distribution": [{"bucket": b, "count": c} for b, c in buckets],
        "item_metrics": item_metrics,
        "cohorts": {
            "excellence_count": len(cohorts["excellence"]),
            "steady_count": len(cohorts["steady"]),
            "attention_count": len(cohorts["attention_needed"]),
            "attention_aliases": cohorts["attention_needed"][:12],
        },
        "chart_path": str(chart_path),
    }


def _render_analytics_chart(
    scores: list[float],
    buckets: list[tuple[str, int]],
    item_metrics: list[dict[str, Any]],
    out_path: Path,
) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2), dpi=180)
    fig.patch.set_facecolor("#FFFFFF")

    # Left: Score bucket bar chart
    ax1 = axes[0]
    labels = [b[0] for b in buckets]
    counts = [b[1] for b in buckets]
    colors = ["#EF4444", "#F59E0B", "#0EA5E9", "#2563EB", "#0071E3"]
    bars = ax1.bar(labels, counts, color=colors[: len(labels)], width=0.56, zorder=3)
    ax1.set_title("成绩分段分布（脱敏样本）", fontsize=12, fontweight="bold", color="#0F172A", pad=10)
    ax1.set_ylabel("人数", fontsize=10, color="#334155")
    ax1.grid(axis="y", linestyle="--", alpha=0.35, zorder=0)
    ax1.spines["top"].set_visible(False)
    ax1.spines["right"].set_visible(False)
    for bar, cnt in zip(bars, counts):
        ax1.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.3, str(cnt), ha="center", va="bottom", fontsize=9, fontweight="bold")

    # Right: Item mastery horizontal bar chart
    ax2 = axes[1]
    if item_metrics:
        item_names = [m["item"][:12] for m in item_metrics][::-1]
        mastery_vals = [m["mastery_pct"] for m in item_metrics][::-1]
        bar_colors = ["#EF4444" if v < 70 else ("#F59E0B" if v < 82 else "#10B981") for v in mastery_vals]
        hbars = ax2.barh(item_names, mastery_vals, color=bar_colors, height=0.56, zorder=3)
        ax2.axvline(70, color="#EF4444", linestyle=":", linewidth=1.2, label="70% 预警线")
        ax2.set_xlim(0, 108)
        ax2.set_title("各题/知识点平均掌握率 (%)", fontsize=12, fontweight="bold", color="#0F172A", pad=10)
        ax2.grid(axis="x", linestyle="--", alpha=0.35, zorder=0)
        ax2.spines["top"].set_visible(False)
        ax2.spines["right"].set_visible(False)
        for bar, v in zip(hbars, mastery_vals):
            ax2.text(v + 1.5, bar.get_y() + bar.get_height() / 2, f"{v:.1f}%", va="center", fontsize=8.5, fontweight="bold")
    else:
        ax2.text(0.5, 0.5, "无细分小题数据", ha="center", va="center")

    plt.tight_layout(pad=2.0)
    plt.savefig(str(out_path), dpi=180)
    plt.close(fig)
