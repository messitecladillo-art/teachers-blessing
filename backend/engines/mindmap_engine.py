"""Native Mind Map Graph Engine & Draw.io (mxGraphModel) Bidirectional XML Compiler."""

from __future__ import annotations

import re
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from core.config import EXPORTS_DIR

NODE_CATEGORY_STYLES: dict[str, dict[str, str]] = {
    "root": {"fill": "#1B4D3E", "stroke": "#12362B", "fontColor": "#FFFFFF", "fontStyle": "1", "fontSize": "15"},
    "principle": {"fill": "#E6EFEA", "stroke": "#1B4D3E", "fontColor": "#14191F", "fontStyle": "1", "fontSize": "13"},
    "intuition": {"fill": "#FDFCF9", "stroke": "#1B4D3E", "fontColor": "#14191F", "fontStyle": "0", "fontSize": "12"},
    "socratic": {"fill": "#EAE5DC", "stroke": "#424B54", "fontColor": "#14191F", "fontStyle": "0", "fontSize": "12"},
    "pitfall": {"fill": "#FAECE9", "stroke": "#B43B2A", "fontColor": "#7F1D1D", "fontStyle": "0", "fontSize": "12"},
    "interdisciplinary": {"fill": "#FEF5E7", "stroke": "#9A5B13", "fontColor": "#7C2D12", "fontStyle": "0", "fontSize": "12"},
}


def _safe_filename(name: str, fallback: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\s]+', "_", (name or "").strip()).strip("_")
    return cleaned[:48] or fallback


def _short_text(text: str, max_len: int = 38) -> str:
    s = re.sub(r"\s+", " ", (text or "").strip())
    return s if len(s) <= max_len else s[: max_len - 1] + "…"


def auto_layout_mindmap(graph: dict[str, Any]) -> dict[str, Any]:
    """Compute clean non-overlapping coordinates for tree_right / mindmap_lr layouts."""
    layout = str(graph.get("layout") or "mindmap_lr")
    raw_nodes: list[dict[str, Any]] = [dict(n) for n in (graph.get("nodes") or [])]
    if not raw_nodes:
        return {**graph, "layout": layout, "nodes": []}

    by_id = {n["id"]: n for n in raw_nodes}
    roots = [n for n in raw_nodes if not n.get("parent_id") or n.get("parent_id") not in by_id]
    root = roots[0] if roots else raw_nodes[0]
    root["parent_id"] = None
    root["level"] = 0
    root["side"] = "center"
    root["category"] = "root"

    children_map: dict[str, list[dict[str, Any]]] = {n["id"]: [] for n in raw_nodes}
    for n in raw_nodes:
        pid = n.get("parent_id")
        if pid and pid in children_map and n["id"] != root["id"]:
            children_map[pid].append(n)

    if layout == "free":
        # Preserve existing manual coordinates, fill defaults only if missing
        for idx, n in enumerate(raw_nodes):
            n.setdefault("x", 480.0 + (idx % 3) * 180.0)
            n.setdefault("y", 280.0 + (idx // 3) * 90.0)
            n.setdefault("level", 0 if n["id"] == root["id"] else 1)
            n.setdefault("side", "center" if n["id"] == root["id"] else "right")
        return {**graph, "layout": layout, "nodes": raw_nodes}

    def subtree_weight(nid: str, depth: int = 0) -> int:
        if depth > 6:
            return 1
        ch = children_map.get(nid, [])
        if not ch:
            return 1
        return sum(subtree_weight(c["id"], depth + 1) for c in ch)

    top_children = children_map.get(root["id"], [])
    if layout == "tree_right":
        left_branches: list[dict[str, Any]] = []
        right_branches = top_children
        root_x = 120.0
    else:
        left_branches = [b for idx, b in enumerate(top_children) if idx % 2 == 1]
        right_branches = [b for idx, b in enumerate(top_children) if idx % 2 == 0]
        root_x = 540.0

    row_gap = 68.0
    x_step = 235.0
    left_w = sum(subtree_weight(b["id"]) for b in left_branches)
    right_w = sum(subtree_weight(b["id"]) for b in right_branches)
    max_units = max(4, left_w, right_w)
    center_y = max(240.0, (max_units * row_gap) / 2.0 + 40.0)
    root["x"] = round(root_x, 1)
    root["y"] = round(center_y, 1)

    def place_side(branches: list[dict[str, Any]], direction: int) -> None:
        total_u = max(1, sum(subtree_weight(b["id"]) for b in branches))
        cursor_y = center_y - (total_u * row_gap) / 2.0 + row_gap / 2.0

        def walk(node: dict[str, Any], level: int, top_cursor: float) -> float:
            w = subtree_weight(node["id"])
            span = w * row_gap
            node["level"] = level
            node["side"] = "left" if direction < 0 else "right"
            node["x"] = round(root_x + direction * level * x_step, 1)
            node["y"] = round(top_cursor + span / 2.0 - row_gap / 2.0, 1)
            ch = children_map.get(node["id"], [])
            if ch:
                c_y = top_cursor
                for child in ch:
                    cw = subtree_weight(child["id"])
                    c_y = walk(child, level + 1, c_y)
            return top_cursor + span

        y_acc = cursor_y
        for br in branches:
            y_acc = walk(br, 1, y_acc)

    if right_branches:
        place_side(right_branches, 1)
    if left_branches:
        place_side(left_branches, -1)

    return {**graph, "layout": layout, "nodes": raw_nodes}


def compile_drawio_xml(graph: dict[str, Any], map_id: str) -> tuple[str, Path]:
    """Compile normalized MindMapGraph into standard app.diagrams.net / VS Code Draw.io mxfile XML."""
    laid_out = auto_layout_mindmap(graph)
    title = str(laid_out.get("title") or "师承智境思维导图")
    nodes = laid_out.get("nodes") or []
    cross_links = laid_out.get("cross_links") or []

    mxfile = ET.Element(
        "mxfile",
        {
            "host": "app.diagrams.net",
            "modified": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "agent": "EduForge-Studio-v3",
            "version": "24.7.0",
            "type": "device",
        },
    )
    diagram = ET.SubElement(mxfile, "diagram", {"id": f"diag_{map_id}", "name": title[:40]})
    model = ET.SubElement(
        diagram,
        "mxGraphModel",
        {
            "dx": "1420",
            "dy": "900",
            "grid": "1",
            "gridSize": "10",
            "guides": "1",
            "tooltips": "1",
            "connect": "1",
            "arrows": "1",
            "fold": "1",
            "page": "1",
            "pageScale": "1",
            "pageWidth": "1400",
            "pageHeight": "900",
            "math": "0",
            "shadow": "0",
        },
    )
    root_el = ET.SubElement(model, "root")
    ET.SubElement(root_el, "mxCell", {"id": "0"})
    ET.SubElement(root_el, "mxCell", {"id": "1", "parent": "0"})

    node_by_id = {n["id"]: n for n in nodes}
    for n in nodes:
        cat = str(n.get("category") or "intuition")
        st = NODE_CATEGORY_STYLES.get(cat, NODE_CATEGORY_STYLES["intuition"])
        lvl = int(n.get("level") or 0)
        w = 210 if lvl == 0 else (184 if lvl == 1 else 168)
        h = 56 if lvl == 0 else (46 if lvl == 1 else 40)
        x_left = float(n.get("x", 480.0)) - w / 2.0
        y_top = float(n.get("y", 280.0)) - h / 2.0
        note = str(n.get("note") or "").strip()
        label_val = str(n.get("label") or "")

        style_str = (
            f"rounded=1;whiteSpace=wrap;html=1;arcSize=16;"
            f"fillColor={st['fill']};strokeColor={st['stroke']};strokeWidth={'2' if lvl <= 1 else '1.2'};"
            f"fontColor={st['fontColor']};fontStyle={st['fontStyle']};fontSize={st['fontSize']};"
            f"eduCategory={cat};"
        )
        cell_attrs = {
            "id": str(n["id"]),
            "value": label_val,
            "style": style_str,
            "vertex": "1",
            "parent": "1",
        }
        if note:
            cell_attrs["tooltip"] = note
        cell = ET.SubElement(root_el, "mxCell", cell_attrs)
        ET.SubElement(
            cell,
            "mxGeometry",
            {
                "x": f"{x_left:.1f}",
                "y": f"{y_top:.1f}",
                "width": f"{w}",
                "height": f"{h}",
                "as": "geometry",
            },
        )

    # Hierarchical tree edges
    for n in nodes:
        pid = n.get("parent_id")
        if not pid or pid not in node_by_id:
            continue
        side = str(n.get("side") or "right")
        if side == "left":
            exit_x, entry_x = "0", "1"
        else:
            exit_x, entry_x = "1", "0"
        st = NODE_CATEGORY_STYLES.get(str(n.get("category") or ""), NODE_CATEGORY_STYLES["intuition"])
        edge_style = (
            f"edgeStyle=orthogonalEdgeStyle;curved=1;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;"
            f"exitX={exit_x};exitY=0.5;entryX={entry_x};entryY=0.5;"
            f"strokeColor={st['stroke']};strokeWidth={'2' if int(n.get('level') or 1) == 1 else '1.4'};endArrow=none;"
        )
        edge = ET.SubElement(
            root_el,
            "mxCell",
            {
                "id": f"e_{pid}_{n['id']}",
                "style": edge_style,
                "edge": "1",
                "parent": "1",
                "source": str(pid),
                "target": str(n["id"]),
            },
        )
        ET.SubElement(edge, "mxGeometry", {"relative": "1", "as": "geometry"})

    # Cross-disciplinary dashed links
    for idx, lk in enumerate(cross_links):
        src = str(lk.get("source") or "")
        dst = str(lk.get("target") or "")
        if src not in node_by_id or dst not in node_by_id:
            continue
        edge = ET.SubElement(
            root_el,
            "mxCell",
            {
                "id": str(lk.get("id") or f"cl_{idx}"),
                "value": str(lk.get("label") or "跨学科映射"),
                "style": "curved=1;dashed=1;dashPattern=6 4;strokeColor=#B43B2A;strokeWidth=1.8;fontColor=#B43B2A;fontSize=11;endArrow=classic;html=1;",
                "edge": "1",
                "parent": "1",
                "source": src,
                "target": dst,
            },
        )
        ET.SubElement(edge, "mxGeometry", {"relative": "1", "as": "geometry"})

    ET.indent(mxfile, space="  ")
    xml_str = ET.tostring(mxfile, encoding="unicode")

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"思维导图_{_safe_filename(title, map_id)}_{map_id}.drawio"
    out_path = EXPORTS_DIR / fname
    out_path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + xml_str, encoding="utf-8")
    return xml_str, out_path


def parse_drawio_xml_to_graph(xml_str: str, fallback_title: str = "导入思维导图") -> dict[str, Any]:
    """Parse external or diagrams.net-edited .drawio XML cleanly back into structured MindMapGraph."""
    raw = (xml_str or "").strip()
    if not raw:
        raise ValueError("空的 Draw.io XML 内容")
    root_xml = ET.fromstring(raw)

    diag_el = root_xml.find(".//diagram")
    title = (diag_el.attrib.get("name") if diag_el is not None else "") or fallback_title
    cells = root_xml.findall(".//mxCell")

    vertices: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for c in cells:
        cid = c.attrib.get("id", "")
        if cid in ("0", "1", ""):
            continue
        if c.attrib.get("vertex") == "1":
            geom = c.find("mxGeometry")
            x_v = float(geom.attrib.get("x", "300")) if geom is not None else 300.0
            y_v = float(geom.attrib.get("y", "240")) if geom is not None else 240.0
            w_v = float(geom.attrib.get("width", "160")) if geom is not None else 160.0
            h_v = float(geom.attrib.get("height", "44")) if geom is not None else 44.0
            style = c.attrib.get("style", "")
            m_cat = re.search(r"eduCategory=([a-zA-Z_]+)", style)
            cat = m_cat.group(1) if m_cat else "intuition"
            if "#1B4D3E" in style and "fontColor=#FFFFFF" in style:
                cat = "root"
            elif "#B43B2A" in style:
                cat = "pitfall"
            elif "#9A5B13" in style:
                cat = "interdisciplinary"
            raw_label = re.sub(r"<[^>]+>", " ", c.attrib.get("value", "")).strip() or cid
            vertices.append(
                {
                    "id": cid,
                    "label": raw_label,
                    "parent_id": None,
                    "level": 1,
                    "side": "right",
                    "category": cat,
                    "note": c.attrib.get("tooltip", ""),
                    "x": round(x_v + w_v / 2.0, 1),
                    "y": round(y_v + h_v / 2.0, 1),
                }
            )
        elif c.attrib.get("edge") == "1":
            src = c.attrib.get("source")
            tgt = c.attrib.get("target")
            if src and tgt:
                edges.append(
                    {
                        "id": cid,
                        "source": src,
                        "target": tgt,
                        "label": re.sub(r"<[^>]+>", " ", c.attrib.get("value", "")).strip(),
                        "dashed": "dashed=1" in c.attrib.get("style", ""),
                    }
                )

    v_map = {v["id"]: v for v in vertices}
    cross_links: list[dict[str, Any]] = []
    for e in edges:
        src, tgt = e["source"], e["target"]
        if src not in v_map or tgt not in v_map:
            continue
        if e["dashed"] or (v_map[tgt]["parent_id"] is not None):
            cross_links.append({"id": e["id"], "source": src, "target": tgt, "label": e["label"] or "跨分支关联"})
        else:
            v_map[tgt]["parent_id"] = src

    roots = [v for v in vertices if v["parent_id"] is None]
    if roots:
        roots[0]["level"] = 0
        roots[0]["side"] = "center"
        roots[0]["category"] = "root"
        rx = roots[0]["x"]
        for v in vertices:
            if v["id"] != roots[0]["id"]:
                v["side"] = "left" if v["x"] < rx else "right"

    # Compute BFS depth
    queue = [roots[0]] if roots else []
    visited = {r["id"] for r in queue}
    while queue:
        cur = queue.pop(0)
        for v in vertices:
            if v["parent_id"] == cur["id"] and v["id"] not in visited:
                v["level"] = cur["level"] + 1
                visited.add(v["id"])
                queue.append(v)

    return {
        "title": title,
        "layout": "free",
        "nodes": vertices,
        "cross_links": cross_links,
    }


def build_mindmap_from_topic(topic: dict[str, Any], custom_title: str = "") -> dict[str, Any]:
    """Convert any rich pedagogy topic into an interconnected multi-level MindMapGraph."""
    title = custom_title or topic.get("title", "学科知识思维导图").split("：")[0][:36]
    nodes: list[dict[str, Any]] = [
        {
            "id": "n_root",
            "label": title,
            "parent_id": None,
            "level": 0,
            "side": "center",
            "category": "root",
            "note": f"{topic.get('domain_name','')} · {topic.get('branch','')} · {topic.get('core_formula_latex','')}",
        }
    ]

    # Branch 1: Intuition models (right)
    nodes.append(
        {
            "id": "n_int",
            "label": "直观心智模型",
            "parent_id": "n_root",
            "level": 1,
            "side": "right",
            "category": "principle",
            "note": "用生活或几何物理直觉锚定抽象概念",
        }
    )
    for i, im in enumerate((topic.get("intuition_models") or [])[:2], start=1):
        nodes.append(
            {
                "id": f"n_int_{i}",
                "label": _short_text(im.get("name", ""), 26),
                "parent_id": "n_int",
                "level": 2,
                "side": "right",
                "category": "intuition",
                "note": im.get("desc", ""),
            }
        )

    # Branch 2: Teaching / derivation flow (left)
    nodes.append(
        {
            "id": "n_flow",
            "label": "标准推演脉络",
            "parent_id": "n_root",
            "level": 1,
            "side": "left",
            "category": "principle",
            "note": topic.get("curriculum_standard", ""),
        }
    )
    for i, st in enumerate((topic.get("teaching_flow") or [])[:3], start=1):
        nodes.append(
            {
                "id": f"n_flow_{i}",
                "label": _short_text(re.sub(r"^\d+\.\s*", "", st), 28),
                "parent_id": "n_flow",
                "level": 2,
                "side": "left",
                "category": "socratic",
                "note": st,
            }
        )

    # Branch 3: Pitfalls & counterexamples (right)
    nodes.append(
        {
            "id": "n_pit",
            "label": "反例与易错陷阱",
            "parent_id": "n_root",
            "level": 1,
            "side": "right",
            "category": "pitfall",
            "note": "高频错误与边界禁区警示",
        }
    )
    for i, pf in enumerate((topic.get("pitfalls_and_counterexamples") or [])[:2], start=1):
        nodes.append(
            {
                "id": f"n_pit_{i}",
                "label": _short_text(pf, 28),
                "parent_id": "n_pit",
                "level": 2,
                "side": "right",
                "category": "pitfall",
                "note": pf,
            }
        )

    # Branch 4: Interdisciplinary links (left)
    nodes.append(
        {
            "id": "n_pbl",
            "label": "跨学科耦合视角",
            "parent_id": "n_root",
            "level": 1,
            "side": "left",
            "category": "interdisciplinary",
            "note": topic.get("board_punchline", ""),
        }
    )
    for i, lk in enumerate((topic.get("interdisciplinary_links") or [])[:2], start=1):
        nodes.append(
            {
                "id": f"n_pbl_{i}",
                "label": _short_text(f"[{lk.get('domain','')}] {lk.get('title','')}", 30),
                "parent_id": "n_pbl",
                "level": 2,
                "side": "left",
                "category": "interdisciplinary",
                "note": lk.get("mechanism", ""),
            }
        )

    cross_links: list[dict[str, Any]] = []
    if len(nodes) > 4 and any(n["id"] == "n_int_1" for n in nodes) and any(n["id"] == "n_pbl_1" for n in nodes):
        cross_links.append({"id": "cl_1", "source": "n_int_1", "target": "n_pbl_1", "label": "模型跨界迁移"})
    if any(n["id"] == "n_flow_1" for n in nodes) and any(n["id"] == "n_pit_1" for n in nodes):
        cross_links.append({"id": "cl_2", "source": "n_pit_1", "target": "n_flow_1", "label": "边界反例校验"})

    return auto_layout_mindmap(
        {
            "title": title,
            "layout": "mindmap_lr",
            "nodes": nodes,
            "cross_links": cross_links,
        }
    )
