from __future__ import annotations

import html
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "docs" / "design"
F1 = ROOT / "boards" / "f1"
F2 = ROOT / "boards" / "f2"
F3 = ROOT / "boards" / "f3"

W, H = 1440, 900
C = {
    "bg": "#e8e6df",
    "surface": "#f7f6f1",
    "raised": "#fffefb",
    "line": "#d6d3c8",
    "line_strong": "#b9b5a7",
    "ink": "#191b19",
    "muted": "#5c615b",
    "faint": "#979c93",
    "accent": "#f4581c",
    "pass": "#2b8a3e",
    "block": "#d64545",
    "warn": "#c77700",
    "unknown": "#7c8288",
}
MONO = "ui-monospace, 'SF Mono', Consolas, monospace"
SANS = "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"


def esc(value: str) -> str:
    return html.escape(str(value), quote=True)


def rect(x, y, w, h, fill="none", stroke="none", sw=1, rx=0, dash=None, opacity=1):
    extra = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" rx="{rx}" opacity="{opacity}"{extra}/>'


def line(x1, y1, x2, y2, stroke=C["line"], sw=1, dash=None, opacity=1):
    extra = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}" opacity="{opacity}"{extra}/>'


def circle(cx, cy, r, fill="none", stroke="none", sw=1):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'


def txt(x, y, value, size=13, fill=None, weight=400, anchor="start", family=SANS, letter=0, opacity=1):
    fill = fill or C["ink"]
    ff = html.escape(family, quote=True)
    return f'<text x="{x}" y="{y}" fill="{fill}" font-family="{ff}" font-size="{size}px" font-weight="{weight}" text-anchor="{anchor}" letter-spacing="{letter}px" opacity="{opacity}">{esc(value)}</text>'


def multiline(x, y, lines, size=13, fill=None, weight=400, leading=20, family=SANS, letter=0):
    return "".join(txt(x, y + i * leading, line_text, size, fill, weight, family=family, letter=letter) for i, line_text in enumerate(lines))


def pill(x, y, label, color, width=None):
    width = width or max(58, len(label) * 10 + 18)
    return rect(x, y - 15, width, 23, fill="none", stroke=color, sw=1) + txt(x + width / 2, y + 1, label, 11, color, 700, "middle")


def field(x, y, label, value, width=220, muted=False):
    fill = C["faint"] if muted else C["ink"]
    return txt(x, y, label, 10, C["faint"], 700, family=MONO, letter=0.4) + txt(x, y + 23, value, 13, fill, 600) + line(x, y + 31, x + width, y + 31, C["line_strong"], 1)


def top_header(project="我的第一台 DIY 主机", state="规则引擎在线 · 12 条规则"):
    out = []
    out.append(line(80, 77, 1360, 77, C["ink"], 2))
    out.append(rect(80, 22, 28, 28, fill=C["accent"]))
    out.append(txt(94, 42, "R", 15, "#ffffff", 800, "middle"))
    out.append(txt(120, 38, "装机清单工作台", 15, C["ink"], 800))
    out.append(txt(120, 58, "先确认能装，再决定买什么。", 11, C["muted"], 400))
    out.append(circle(1160, 36, 3.5, fill=C["pass"]))
    out.append(txt(1172, 40, state, 11, C["muted"], 600))
    out.append(txt(1360, 40, "RIGMATE", 10, C["faint"], 800, "end", family=MONO, letter=1.4))
    return "".join(out)


def project_bar(name="我的第一台 DIY 主机", use="2K 游戏", budget="¥10,000", project_count="1 / 8 类"):
    out = [line(80, 111, 1360, 111, C["line"], 1)]
    out.append(field(80, 130, "历史项目", f"{name}（{project_count} 配件 · 09/21 08:18）", 245))
    out.append(field(355, 130, "新项目名称", name, 220))
    out.append(field(605, 130, "主要用途", use, 160))
    out.append(field(815, 130, "预算（元）", budget, 145))
    out.append(rect(1010, 143, 142, 34, fill=C["ink"]))
    out.append(txt(1081, 165, "新建项目  →", 12, "#ffffff", 800, "middle"))
    out.append(rect(1165, 143, 118, 34, fill="none", stroke=C["line_strong"], sw=1))
    out.append(txt(1224, 165, "运行检查 ↗", 12, C["ink"], 800, "middle"))
    out.append(txt(1360, 164, "数据实时保存", 10, C["faint"], 500, "end"))
    return "".join(out)


def title_line(title="我的第一台 DIY 主机", subtitle="用途 2K 游戏 · 更新于 09/21 08:18"):
    return txt(80, 232, title, 25, C["ink"], 800) + txt(80, 257, subtitle, 12, C["muted"], 400)


def budget_strip(budget="¥10,000", priced="¥4,677", unpriced="0 件", diff="¥5,323", ratio=0.468, over=False, ghost=False):
    y = 288
    out = [line(80, y - 14, 1360, y - 14, C["line"], 1)]
    values = [("预算", budget, "项目水平线", ""), ("已计价", priced, "3 / 4 件", "accent"), ("未计价", unpriced, "不按零元计入", ""), ("余量" if not over else "超支", diff, "仅基于已计价部分", "over" if over else "")]
    xs = [80, 248, 424, 580]
    for (label, value, sub, cls), x in zip(values, xs):
        color = C["block"] if cls == "over" else C["accent"] if cls == "accent" else C["ink"]
        out += [txt(x, y, label, 10, C["faint"], 700, family=MONO, letter=0.4), txt(x, y + 25, value, 16, color, 800, family=MONO), txt(x, y + 42, sub, 10, C["faint"])]
    bar_x, bar_y, bar_w = 800, y + 11, 560
    out.append(rect(bar_x, bar_y, bar_w, 12, fill=C["raised"], stroke=C["line_strong"], sw=1))
    if ghost:
        out.append(rect(bar_x, bar_y, bar_w, 12, fill="url(#hatch)", stroke="none"))
    fill_w = bar_w if over else round(bar_w * ratio)
    out.append(rect(bar_x, bar_y, fill_w, 12, fill=C["block"] if over else C["ink"], stroke="none"))
    for pct in (0.25, 0.5, 0.75):
        out.append(line(bar_x + bar_w * pct, bar_y, bar_x + bar_w * pct, bar_y + 12, C["bg"], 1))
    out.append(txt(bar_x, bar_y + 30, "0", 9, C["faint"], 400, family=MONO))
    out.append(txt(bar_x + bar_w, bar_y + 30, budget, 9, C["faint"], 400, "end", MONO))
    if ghost:
        out.append(txt(bar_x, bar_y + 50, "斜纹区间 = 未计价件，补价后差额会变化", 11, C["unknown"], 700))
    return "".join(out)


def section_label(x, y, label, right=None):
    out = [line(x, y + 10, x + 580, y + 10, C["ink"], 1)]
    out.append(txt(x, y, label, 14, C["ink"], 800))
    if right:
        out.append(txt(x + 580, y, right, 11, C["faint"], 700, "end", MONO))
    return "".join(out)


def table(x, y, rows, heading="清单", count="4 / 8 类"):
    out = [section_label(x, y, heading, count)]
    header_y = y + 37
    out += [txt(x, header_y, "类型", 10, C["faint"], 700, family=MONO), txt(x + 58, header_y, "型号 / 关键规格", 10, C["faint"], 700, family=MONO), txt(x + 380, header_y, "价格", 10, C["faint"], 700, "end", MONO), txt(x + 448, header_y, "状态", 10, C["faint"], 700, "end", MONO), line(x, header_y + 9, x + 580, header_y + 9, C["line_strong"], 1)]
    for i, row in enumerate(rows):
        yy = header_y + 36 + i * 48
        if row.get("editing"):
            out.append(rect(x - 5, yy - 22, 590, 43, fill="#fff7f2", stroke="none"))
            out.append(rect(x - 5, yy - 22, 2, 43, fill=C["accent"]))
        out += [txt(x, yy, row["type"], 10, C["faint"], 700, family=MONO), txt(x + 58, yy, row["name"], 13, C["ink"], 700), txt(x + 58, yy + 17, row["spec"], 10, C["faint"], 400), txt(x + 380, yy + 5, row["price"], 12, C["ink"], 700, "end", MONO), txt(x + 448, yy + 5, row["state"], 10, row.get("stateColor", C["pass"]), 700, "end"), txt(x + 500, yy + 5, row.get("action", "改  删"), 10, C["muted"], 700, "end")]
        out.append(line(x, yy + 27, x + 580, yy + 27, C["line"], 1))
    return "".join(out)


def finding(x, y, status, rule, conclusion, evidence, next_step, assumptions=None):
    color = C[status]
    out = [txt(x, y, {"block": "阻断", "unknown": "待补充", "warn": "警告", "pass": "通过"}[status], 11, color, 800), txt(x + 70, y, conclusion, 13, C["ink"], 700), txt(x + 580, y, rule, 10, C["faint"], 400, "end", MONO)]
    out += [txt(x + 70, y + 22, f"· {evidence}", 11, C["muted"], 400), txt(x + 70, y + 39, f"数据日期 2026-09-21 · 置信度 {'高' if status == 'block' else '低' if status == 'unknown' else '中'}", 10, C["faint"], 400, family=MONO)]
    if assumptions:
        out.append(txt(x + 70, y + 56, f"假设条件：{assumptions}", 10, C["faint"], 400))
        next_y = y + 73
    else:
        next_y = y + 56
    out.append(txt(x + 70, next_y, f"下一步：{next_step}", 11, C["accent"], 700))
    out.append(line(x, next_y + 18, x + 600, next_y + 18, C["line"], 1))
    return "".join(out)


def page(title, subtitle, body, defs=True, footer="视觉母版 · 以代码与规则为事实"):
    defs_xml = """<pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#7c8288" stroke-width="2" opacity="0.35"/></pattern>""" if defs else ""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><title>{esc(title)}</title><defs>{defs_xml}</defs><rect width="{W}" height="{H}" fill="{C['bg']}"/><rect x="48" y="40" width="1344" height="820" fill="{C['surface']}" stroke="{C['line_strong']}" stroke-width="1"/>{top_header()}<text x="80" y="72" fill="{C['faint']}" font-family="{MONO}" font-size="10px" letter-spacing="0.8px">{esc(subtitle)}</text>{body}<line x1="80" y1="836" x2="1360" y2="836" stroke="{C['line']}"/><text x="80" y="855" fill="{C['faint']}" font-family="{SANS}" font-size="10px">{esc(footer)}</text><text x="1360" y="855" fill="{C['faint']}" font-family="{MONO}" font-size="10px" text-anchor="end">RIGMATE</text></svg>'''


def board_empty():
    body = project_bar("新项目", "用途待填写", "预算待填写", "0")
    body += title_line("还没有活动项目", "在上方填写项目名称并新建，数据会实时保存到 SQLite")
    body += line(80, 286, 1360, 286, C["line_strong"])
    body += txt(80, 330, "清单为空。", 15, C["ink"], 700)
    body += txt(80, 357, "从下方选择类别、填写型号即可加入。缺少规格时系统不会猜默认值。", 12, C["muted"])
    body += line(80, 392, 1360, 392, C["line"])
    body += section_label(80, 430, "配件录入", "八类可选")
    body += txt(80, 475, "CPU", 13, C["accent"], 700) + line(80, 487, 128, 487, C["accent"], 2)
    body += txt(150, 475, "主板", 13, C["muted"], 600) + txt(220, 475, "显卡", 13, C["muted"], 600) + txt(290, 475, "内存", 13, C["muted"], 600) + txt(360, 475, "SSD/HDD", 13, C["muted"], 600) + txt(455, 475, "电源", 13, C["muted"], 600) + txt(520, 475, "散热器", 13, C["muted"], 600) + txt(600, 475, "机箱", 13, C["muted"], 600)
    body += field(80, 525, "型号或商品名称", "例如：AMD Ryzen 7 9800X3D", 380)
    body += field(500, 525, "价格（元）· 可选", "例如：2899", 160, True)
    body += txt(80, 600, "先创建项目后，配件才会加入清单。", 11, C["faint"])
    body += rect(80, 650, 170, 36, fill=C["ink"]) + txt(165, 674, "新建项目  →", 12, "#ffffff", 800, "middle")
    return page("装机台默认态", "视觉母版 01 / F1 · 空项目", body)


def board_normal():
    body = project_bar("我的第一台 DIY 主机", "2K 游戏", "¥10,000", "4")
    body += title_line("我的第一台 DIY 主机", "用途 2K 游戏 · 更新于 09/21 08:18")
    body += budget_strip("¥10,000", "¥4,677", "0 件", "¥5,323", ratio=0.468)
    body += table(80, 390, [
        {"type": "CPU", "name": "AMD Ryzen 7 9800X3D", "spec": "AM5 · 120W · 目录型号", "price": "¥2,899", "state": "已确认", "action": "改  删"},
        {"type": "MB", "name": "微星 MAG B650M MORTAR WIFI", "spec": "AM5 · DDR5 · mATX", "price": "¥1,099", "state": "已确认", "action": "改  删"},
        {"type": "GPU", "name": "NVIDIA RTX 4070 SUPER", "spec": "220W · 12VHPWR", "price": "¥4,199", "state": "已确认", "action": "改  删"},
        {"type": "PSU", "name": "海韵 FOCUS GX-750", "spec": "750W · 80+ 金牌", "price": "—", "state": "待补充", "stateColor": C["warn"], "action": "改  删"},
    ])
    body += section_label(80, 665, "配件录入", "选择类别 · 规格字段")
    body += txt(80, 705, "CPU", 13, C["accent"], 700) + line(80, 716, 128, 716, C["accent"], 2) + txt(150, 705, "主板", 13, C["muted"], 600) + txt(220, 705, "显卡", 13, C["muted"], 600) + txt(290, 705, "内存", 13, C["muted"], 600)
    body += txt(650, 705, "清单 4 件 · 预算 46.8% 已计价", 11, C["muted"], 600, "end", MONO)
    return page("装机台正常态", "视觉母版 02 / F1 · 已计价 + 待补充", body)


def board_block():
    body = project_bar("黑曜石-2026Q4", "2K 游戏", "¥12,000", "5")
    body += title_line("黑曜石-2026Q4", "用途 2K 游戏 · 检查于 09/21 14:02")
    body += budget_strip("¥12,000", "¥12,899", "1 件", "−¥899", ratio=1, over=True, ghost=True)
    body += table(80, 390, [
        {"type": "GPU", "name": "RTX 4070 SUPER 三风扇", "spec": "长度 336mm · 220W", "price": "¥4,199", "state": "已确认", "action": "改  删"},
        {"type": "CASE", "name": "紧凑型 ITX 机箱", "spec": "显卡限长 320mm", "price": "¥599", "state": "已确认", "action": "改  删"},
        {"type": "PSU", "name": "650W 电源", "spec": "接口资料缺失", "price": "—", "state": "待补充", "stateColor": C["warn"], "action": "改  删"},
    ])
    body += section_label(80, 640, "诊断条款", "阻断 1 · 待补充 1")
    body += finding(80, 690, "block", "R-GPU-CASE-001", "显卡长度 336mm 超过机箱限长 320mm", "显卡规格记录 336mm；机箱规格记录限长 320mm", "更换 ≤320mm 显卡或更大机箱")
    return page("阻断诊断态", "视觉母版 03 / F1 · R-GPU-CASE-001", body)


def board_unknown():
    body = project_bar("升级记录-01", "办公 + 轻游戏", "未设置", "3")
    body += title_line("升级记录-01", "用途 办公 + 轻游戏 · 有效结论 0 条")
    body += budget_strip("未设置", "¥2,199", "2 件", "—", ratio=0, ghost=True)
    body += table(80, 390, [
        {"type": "CPU", "name": "Ryzen 7 9800X3D", "spec": "插槽待确认", "price": "¥2,899", "state": "待补充", "stateColor": C["unknown"], "action": "改  删"},
        {"type": "PSU", "name": "某 750W 电源", "spec": "额定功率待确认", "price": "—", "state": "待补充", "stateColor": C["unknown"], "action": "改  删"},
    ])
    body += section_label(80, 540, "诊断条款", "阻断 0 · 待补充 2")
    body += finding(80, 585, "unknown", "R-CPU-MB-001", "暂时无法判断 CPU 与主板是否兼容", "主板条目不存在，CPU 插槽资料也未确认", "补充主板型号与 CPU 插槽")
    body += finding(80, 680, "unknown", "R-PSU-001", "暂时无法判断电源余量", "电源额定功率与显卡 TDP 资料缺失", "补充额定功率、显卡 TDP")
    return page("待补充主导态", "视觉母版 04 / F1 · unknown 是一等公民", body)


def board_stale():
    body = project_bar("我的第一台 DIY 主机", "2K 游戏", "¥10,000", "4")
    body += title_line("我的第一台 DIY 主机", "清单已修改 · 旧结论等待重新检查")
    body += rect(80, 285, 1280, 36, fill="#fff8ec", stroke=C["warn"], sw=1) + rect(80, 285, 3, 36, fill=C["warn"]) + txt(98, 308, "清单在上次检查之后发生过变化，以下结论基于旧清单，请重新运行检查。", 12, C["warn"], 700)
    body += table(80, 365, [
        {"type": "CPU", "name": "AMD Ryzen 7 9800X3D", "spec": "AM5 · 120W · 正在编辑", "price": "¥2,899", "state": "已确认", "action": "保存 取消", "editing": True},
        {"type": "GPU", "name": "RTX 4070 SUPER", "spec": "长度待确认", "price": "¥4,199", "state": "待补充", "stateColor": C["warn"], "action": "改  删"},
    ])
    body += section_label(80, 540, "最近检查", "可比较 · 不原地覆盖")
    body += txt(80, 580, "#12", 12, C["ink"], 800, family=MONO) + txt(125, 580, "今天 14:02", 12, C["muted"], 600) + txt(250, 580, "3 阻断", 12, C["block"], 800) + line(80, 592, 620, 592, C["line"])
    body += txt(80, 630, "#11", 12, C["faint"], 800, family=MONO) + txt(125, 630, "昨天", 12, C["faint"], 600) + txt(250, 630, "5 阻断", 12, C["faint"], 800) + line(80, 642, 620, 642, C["line"])
    return page("过期与编辑态", "视觉母版 06 / F1 · stale + editing + history", body)


def budget_states():
    bodies = []
    states = [("无预算", "未设置", "¥2,899", "2 件", "—", "该项目未设置预算。未计价件永远不按零元计入。", False, False), ("有余量", "¥10,000", "¥4,677", "0 件", "¥5,323", "全部已计价，余量只基于可追溯的价格。", False, False), ("超支", "¥8,000", "¥9,899", "1 件", "−¥1,899", "已计价金额超过预算水平线。", True, True)]
    for i, (label, budget, priced, unknown, diff, note, over, ghost) in enumerate(states):
        x = 80 + i * 425
        bodies.append(rect(x, 280, 385, 380, fill=C["raised"], stroke=C["line_strong"], sw=1))
        bodies.append(txt(x + 22, 315, label, 15, C["ink"], 800))
        bodies.append(line(x + 22, 328, x + 363, 328, C["line"], 1))
        bodies.append(txt(x + 22, 365, "预算", 10, C["faint"], 700, family=MONO))
        bodies.append(txt(x + 22, 391, budget, 21, C["ink"], 800, family=MONO))
        bodies.append(txt(x + 180, 365, "已计价", 10, C["faint"], 700, family=MONO))
        bodies.append(txt(x + 180, 391, priced, 21, C["accent"] if not over else C["block"], 800, family=MONO))
        bodies.append(txt(x + 22, 435, "未计价", 10, C["faint"], 700, family=MONO))
        bodies.append(txt(x + 22, 461, unknown, 16, C["ink"], 800, family=MONO))
        bodies.append(txt(x + 180, 435, "余量 / 超支", 10, C["faint"], 700, family=MONO))
        bodies.append(txt(x + 180, 461, diff, 16, C["block"] if over else C["ink"], 800, family=MONO))
        if budget != "未设置":
            bx, by, bw = x + 22, 505, 341
            bodies.append(rect(bx, by, bw, 16, fill=C["raised"], stroke=C["line_strong"], sw=1))
            if ghost: bodies.append(rect(bx, by, bw, 16, fill="url(#hatch)", stroke="none"))
            bodies.append(rect(bx, by, bw if over else (bw * (0.584 if i == 1 else 1)), 16, fill=C["block"] if over else C["ink"], stroke="none"))
            for p in (0.25, 0.5, 0.75): bodies.append(line(bx + bw * p, by, bx + bw * p, by + 16, C["bg"], 1))
            bodies.append(txt(bx, by + 32, "0", 9, C["faint"], 400, family=MONO))
            bodies.append(txt(bx + bw, by + 32, budget, 9, C["faint"], 400, "end", MONO))
        bodies.append(txt(x + 22, 600, note, 11, C["muted"], 600))
    return page("预算三态", "视觉母版 05 / F1 · 无预算 / 有余量 / 超支", "".join(bodies))


def report_blueprint():
    body = top_header("报告", "报告模式 · 打印友好")
    body += rect(80, 100, 1280, 62, fill=C["raised"], stroke=C["ink"], sw=1)
    body += txt(98, 126, "RIGMATE / PC DIY 检查报告", 15, C["ink"], 800)
    body += txt(98, 148, "黑曜石-2026Q4 · 2026-09-21 14:02 · 目录版本 4bbac3c", 10, C["muted"], 400, family=MONO)
    body += txt(1340, 126, "REPORT 01", 10, C["faint"], 800, "end", MONO)
    body += txt(1340, 148, "共 04 页", 10, C["faint"], 400, "end", MONO)
    body += txt(80, 210, "结论摘要", 14, C["ink"], 800)
    body += line(80, 220, 1360, 220, C["ink"], 1)
    summary = [("阻断", "1", C["block"]), ("待补充", "2", C["warn"]), ("已计价", "¥4,677", C["ink"]), ("下一步", "更换显卡", C["accent"])]
    for i, (lab, val, col) in enumerate(summary):
        x = 80 + i * 300
        body += txt(x, 260, lab, 10, C["faint"], 700, family=MONO) + txt(x, 290, val, 22, col, 800, family=MONO) + line(x, 306, x + 260, 306, C["line"], 1)
    body += txt(80, 355, "兼容性条款", 14, C["ink"], 800) + line(80, 365, 1360, 365, C["ink"], 1)
    body += finding(80, 405, "block", "R-GPU-CASE-001", "显卡长度 336mm 超过机箱限长 320mm", "显卡规格记录 336mm；机箱规格记录限长 320mm", "更换 ≤320mm 显卡或更大机箱")
    body += finding(80, 505, "unknown", "R-PSU-001", "暂时无法判断电源余量", "电源额定功率与显卡 TDP 资料缺失", "补充额定功率、显卡 TDP")
    body += txt(80, 625, "数据与假设", 14, C["ink"], 800) + line(80, 635, 1360, 635, C["ink"], 1)
    body += multiline(80, 675, ["· 所有结论由规则编号与规格字段计算，不由模型猜测。", "· 未计价件不按零元计入预算差额。", "· 价格参考截至 2026-09-21，具体证据见附录台账。"], 11, C["muted"], 500, 21)
    body += rect(1050, 740, 310, 48, fill="none", stroke=C["line_strong"], sw=1) + txt(1070, 770, "RIGMATE / 规则优先 · 证据可复核", 10, C["faint"], 700, family=MONO)
    return page("报告页", "视觉母版 07 / F1 · 浅色工程图纸风（规划参考）", body, footer="规划参考 · 尚未实现路由 /builds/[id]/report")


def check_ritual():
    body = project_bar("黑曜石-2026Q4", "2K 游戏", "¥10,000", "4")
    body += title_line("检查序列", "一次检查不是黑箱，是一组可看见的步骤")
    body += line(80, 285, 1360, 285, C["line_strong"], 1)
    steps = [("CPU INIT", "通过", C["pass"]), ("DRAM", "通过", C["pass"]), ("VGA", "检查中", C["accent"]), ("POWER", "等待", C["faint"]), ("CASE", "等待", C["faint"])]
    for i, (label, state, color) in enumerate(steps):
        x = 130 + i * 245
        if i < len(steps) - 1: body += line(x + 18, 390, x + 225, 390, C["line_strong"], 1)
        body += circle(x, 390, 18, fill=C["surface"], stroke=color, sw=2)
        body += txt(x, 396, "✓" if state == "通过" else "…" if state == "检查中" else "·", 15, color, 800, "middle", MONO)
        body += txt(x, 438, label, 11, C["ink"], 800, "middle", MONO)
        body += txt(x, 458, state, 10, color, 700, "middle")
    body += rect(80, 540, 1280, 128, fill=C["raised"], stroke=C["line"], sw=1)
    body += txt(110, 578, "VGA / 物理空间检查", 14, C["ink"], 800)
    body += txt(110, 608, "显卡 336mm  ·  机箱限长 320mm", 12, C["muted"], 600, family=MONO)
    body += txt(110, 638, "未通过：检查序列在此停住，用户看见哪一个事实导致阻断。", 11, C["block"], 700)
    body += rect(1080, 585, 170, 38, fill=C["ink"]) + txt(1165, 610, "查看诊断 →", 12, "#ffffff", 800, "middle")
    return page("检查仪式", "视觉母版 08 / F1 · POST 检查序列关键帧（规划参考）", body, footer="规划参考 · 动画实现需响应 prefers-reduced-motion")


def f2_market():
    body = top_header("行情台", "V1-B 规划参考 · 只回放已发生证据")
    body += project_bar("关注列表", "价格观察", "—", "—")
    body += txt(80, 235, "行情台", 24, C["ink"], 800) + txt(80, 260, "只显示有来源、有日期、可比较的历史观察。没有预测线。", 12, C["muted"], 400)
    body += line(80, 292, 1360, 292, C["ink"], 1)
    cols = [(80, "型号"), (500, "最新观察价"), (700, "7天变化"), (900, "新鲜度"), (1110, "证据数")]
    for x, label in cols: body += txt(x, 328, label, 10, C["faint"], 700, family=MONO)
    rows = [("AMD Ryzen 7 9800X3D", "¥2,899", "—", "● 较新", "3 条"), ("RTX 4070 SUPER", "¥4,199", "−2.1%", "◐ 近期", "8 条"), ("微星 B650M MORTAR", "¥1,099", "+1.8%", "○ 较旧", "2 条")]
    for i, row in enumerate(rows):
        y = 370 + i * 54
        body += line(80, y - 20, 1360, y - 20, C["line"], 1)
        body += txt(80, y, row[0], 13, C["ink"], 700) + txt(500, y, row[1], 13, C["ink"], 800, family=MONO) + txt(700, y, row[2], 12, C["muted"], 700, family=MONO) + txt(900, y, row[3], 11, C["pass"] if "较新" in row[3] else C["warn"], 700) + txt(1110, y, row[4], 11, C["muted"], 600, family=MONO)
    body += txt(80, 620, "行情台是证据回放，不是最低价承诺。", 11, C["faint"], 600)
    return page("行情台关注列表", "视觉母版 F2 / B1 · 规划参考（尚未实现）", body, footer="规划参考 · V1-B 价格证据链")


def f2_timeline():
    body = top_header("单品详情", "V1-B 规划参考 · 价格快照时间线")
    body += title_line("AMD Ryzen 7 9800X3D", "同一标准型号 · 3 条可比证据 · 截至 2026-09-21")
    body += line(80, 285, 1360, 285, C["ink"], 1)
    chart_x, chart_y, chart_w, chart_h = 150, 340, 1050, 360
    body += line(chart_x, chart_y + chart_h, chart_x + chart_w, chart_y + chart_h, C["line_strong"], 1)
    body += line(chart_x, chart_y, chart_x, chart_y + chart_h, C["line_strong"], 1)
    for i, price in enumerate((2600, 2800, 3000, 3200)):
        y = chart_y + chart_h - i * 100
        body += line(chart_x, y, chart_x + chart_w, y, C["line"], 1, dash="3 5") + txt(chart_x - 12, y + 4, f"¥{price}", 10, C["faint"], 400, "end", MONO)
    points = [(280, 565, "京东自营"), (430, 505, "京东自营"), (620, 525, "第三方"), (800, 450, "京东自营"), (1010, 470, "京东自营")]
    for i in range(len(points) - 1): body += line(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], C["ink"], 1)
    for x, y, label in points:
        body += circle(x, y, 5, fill=C["accent"], stroke=C["surface"], sw=2) + txt(x, y - 13, label, 10, C["faint"], 400, "middle")
    body += txt(chart_x, chart_y + chart_h + 35, "09/15", 10, C["faint"], 400, family=MONO) + txt(chart_x + chart_w, chart_y + chart_h + 35, "09/21", 10, C["faint"], 400, "end", MONO)
    body += txt(80, 780, "散点 = 观察证据 · 颜色 = 渠道/商品状态 · 透明度 = 新鲜度", 11, C["muted"], 600)
    return page("快照时间线", "视觉母版 F2 / B2 · 规划参考（尚未实现）", body, footer="规划参考 · 无预测线，只回放历史观察")


def f2_evidence():
    body = top_header("证据台账", "V1-B 规划参考 · 追加式、可复核")
    body += title_line("证据台账", "全部价格快照与规格来源 · 任何结论都可跳回这里")
    body += line(80, 285, 1360, 285, C["ink"], 1)
    cols = [(80, "时间"), (240, "标准型号"), (600, "来源 / 店铺"), (860, "口径"), (1050, "价格"), (1180, "证据")]
    for x, label in cols: body += txt(x, 325, label, 10, C["faint"], 700, family=MONO)
    rows = [("09/21 14:02", "9800X3D", "用户提交 · 京东自营", "全新 / 券后", "¥2,899", "可比 · 较新"), ("09/19 09:11", "9800X3D", "用户提交 · 第三方", "全新", "¥3,099", "可比 · 较旧"), ("09/18 20:30", "9800X3D", "用户提交 · 闲鱼", "二手", "¥2,100", "不可混比")]
    for i, row in enumerate(rows):
        y = 370 + i * 58
        body += line(80, y - 22, 1360, y - 22, C["line"], 1)
        body += txt(80, y, row[0], 11, C["muted"], 400, family=MONO) + txt(240, y, row[1], 13, C["ink"], 700) + txt(600, y, row[2], 11, C["muted"], 600) + txt(860, y, row[3], 11, C["muted"], 600) + txt(1050, y, row[4], 13, C["ink"], 800, family=MONO) + txt(1180, y, row[5], 11, C["pass"] if "不可" not in row[5] else C["warn"], 700)
    body += txt(80, 610, "追加式记录 · 不覆盖旧证据 · 详情页可追溯原始链接与截图。", 11, C["faint"], 600)
    return page("证据台账", "视觉母版 F2 / B4 · 规划参考（尚未实现）", body, footer="规划参考 · 证据三件套：来源 · 日期 · 等级")


def f3_copilot():
    body = top_header("装机副驾", "V1-C 规划参考 · LLM 可关闭，产品仍完整")
    body += project_bar("黑曜石-2026Q4", "2K 游戏", "¥10,000", "4")
    body += title_line("装机副驾", "它只解释、抽取、提议；事实数字来自规则与证据")
    body += line(80, 285, 1360, 285, C["ink"], 1)
    body += txt(80, 325, "输入", 10, C["faint"], 700, family=MONO) + txt(80, 355, "“把这份商品标题整理成标准型号，并告诉我缺什么。”", 15, C["ink"], 600)
    body += line(80, 380, 780, 380, C["line"], 1)
    cards = [("parse_result", "已识别", "CPU · AMD Ryzen 7 9800X3D", "置信度 高", C["pass"]), ("match_candidates", "需要确认", "候选 2 个 · 差异：盒装 / 散片", "点击确认型号", C["warn"]), ("proposal", "变更提议", "建议补充：CPU 插槽 = AM5", "接受   忽略", C["accent"]), ("error", "降级说明", "目录未覆盖该中文标题，已保留原文，不猜型号。", "手动补充", C["unknown"])]
    for i, (kind, label, content, action, col) in enumerate(cards):
        y = 430 + i * 78
        body += line(80, y - 24, 780, y - 24, C["line"], 1)
        body += txt(80, y, label, 11, col, 800) + txt(190, y, content, 12, C["ink"], 600) + txt(730, y, action, 10, col, 800, "end", MONO)
    body += rect(900, 322, 460, 365, fill=C["raised"], stroke=C["line_strong"], sw=1) + txt(930, 360, "为什么这么说", 13, C["ink"], 800) + line(930, 374, 1330, 374, C["line"], 1)
    body += multiline(930, 410, ["这不是自由文本结论。", "", "候选来自目录匹配；差异字段来自", "标准型号记录；写操作必须经过", "你的确认。", "", "[ 接受提议 ]    [ 忽略 ]"], 12, C["muted"], 500, 25)
    return page("装机副驾", "视觉母版 F3 / C1 · 规划参考（尚未实现）", body, footer="规划参考 · 七类类型化事件，LLM 关闭时仍可用")


def write_board(folder, slug, title, subtitle, svg_text, note):
    folder.mkdir(parents=True, exist_ok=True)
    svg_path = folder / f"{slug}.svg"
    md_path = folder / f"{slug}.md"
    svg_path.write_text(svg_text, encoding="utf-8")
    md_path.write_text(note, encoding="utf-8")


BOARDS = [
    (F1, "01-workbench-empty", "装机台默认态", "F1 已实现 · / · 空项目", board_empty(), """# 装机台默认态·仪器白\n\n- **映射**：`/`，当前 `src/app/page.tsx` 空项目状态。\n- **真实数据**：新项目、预算待填写、0 / 8 类。\n- **锁定 tokens**：`--rm-bg`、`--rm-surface`、`--rm-ink`、`--rm-accent`、`--rm-line`。\n- **E2E**：新建项目按钮、八类标签、型号/价格输入框、`N / 8 类`。\n- **验收**：无英文 micro-caps；空态是一行文字；输入是下划线，不是卡片。\n"""),
    (F1, "02-workbench-normal", "装机台正常态", "F1 已实现 · / · 已计价 + 待补充", board_normal(), """# 装机台·清单正常态\n\n- **映射**：`/`，清单规格表 + 预算余量尺。\n- **真实数据**：9800X3D、B650M MORTAR、RTX 4070 SUPER、FOCUS GX-750。\n- **锁定状态**：已确认/待补充、价格 `¥2,899` 等宽右对齐。\n- **验收**：规格表列头与行对齐；预算未计价区按业务规格不折算为零。\n"""),
    (F1, "03-workbench-block", "阻断诊断态", "F1 已实现 · / · R-GPU-CASE-001", board_block(), """# 装机台·阻断诊断\n\n- **映射**：`/`，右侧诊断流。\n- **规则**：`R-GPU-CASE-001`，336mm > 320mm。\n- **锁定状态**：阻断红只用于状态词、边线与超支，不做大面积红底。\n- **验收**：结论、证据、日期、置信度、假设、下一步六要素都出现。\n"""),
    (F1, "04-workbench-unknown", "待补充主导态", "F1 已实现 · / · unknown 一等公民", board_unknown(), """# 装机台·待补充主导\n\n- **映射**：`/`，unknown/未计价状态。\n- **锁定状态**：青灰、虚线/幽灵身份；unknown 排在 warn 前。\n- **产品哲学**：缺字段不猜默认值；未知金额不按零元计入预算。\n"""),
    (F1, "05-budget-states", "预算三态", "F1 已实现 · / · 无预算/有余量/超支", budget_states(), """# 预算三态\n\n- **映射**：`/` 中栏预算余量条。\n- **三个状态**：无预算引导、有余量、超支变红压满。\n- **锁定契约**：`budgetSummary`；未计价件用斜纹幽灵区，不能当 0 元。\n"""),
    (F1, "06-stale-edit-delete", "过期与编辑态", "F1 已实现 · / · stale + editing + history", board_stale(), """# 过期、编辑、历史\n\n- **映射**：`/`，配件编辑/删除与过期横幅。\n- **锁定状态**：编辑行橙色左边线；过期横幅琥珀左边线；历史记录等宽。\n- **后续**：检查历史行目前是视觉参考，尚未持久化完整历史列表。\n"""),
    (F1, "07-report-blueprint", "报告页", "F1 规划 · /builds/[id]/report 尚未实现", report_blueprint(), """# 报告页·浅色工程图纸风\n\n- **映射**：规划路由 `/builds/[id]/report`，尚未实现。\n- **定位**：打印友好，不返回深色主工作台；图框标题栏 + 摘要 + 七类分节。\n- **红线**：不压缩成单个通过/不通过总分。\n"""),
    (F1, "08-check-ritual", "检查仪式", "F1 规划 · POST 序列关键帧", check_ritual(), """# 检查序列关键帧\n\n- **映射**：运行检查的未来动效，尚未实现。\n- **两个允许的动效**：POST 步骤序列；全通过点亮仪式。\n- **降级**：`prefers-reduced-motion` 使用静态报告，不影响功能。\n"""),
    (F2, "markets-watchlist", "行情台关注列表", "F2 规划参考 · 只回放已发生证据", f2_market(), """# 行情台关注列表\n\nF2 规划参考，尚未实现。只显示带来源/日期/口径的历史证据，不显示预测线。\n"""),
    (F2, "snapshot-timeline", "快照时间线", "F2 规划参考 · 散点 + 新鲜度", f2_timeline(), """# 快照时间线\n\nF2 规划参考，尚未实现。散点颜色表达渠道/状态，透明度表达新鲜度；口径混杂时不聚合。\n"""),
    (F2, "evidence-ledger", "证据台账", "F2 规划参考 · 可复核", f2_evidence(), """# 证据台账\n\nF2 规划参考，尚未实现。每条证据追加式保存，来源/日期/等级与结论可互链。\n"""),
    (F3, "copilot-drawer", "装机副驾", "F3 规划参考 · 七事件类型化流", f3_copilot(), """# 装机副驾\n\nF3 规划参考，尚未实现。副驾只能抽取/解释/提议，事实数字来自规则与目录/快照。\n"""),
]

for args in BOARDS:
    write_board(*args)

print(f"generated {len(BOARDS)} SVG boards under {ROOT}")
