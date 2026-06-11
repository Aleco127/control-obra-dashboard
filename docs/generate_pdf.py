"""
Genera PDF del Manual de Usuario - Control de Obra
Convierte el markdown a un PDF profesional con formato.
"""

import re
import os
from fpdf import FPDF

# --- Configuration ---
INPUT_MD = os.path.join(os.path.dirname(__file__), "manual-de-usuario.md")
OUTPUT_PDF = os.path.join(os.path.dirname(__file__), "manual-de-usuario.pdf")

# Colors
COLOR_PRIMARY = (37, 99, 235)      # Blue-600
COLOR_DARK = (30, 41, 59)          # Slate-800
COLOR_GRAY = (100, 116, 139)       # Slate-500
COLOR_LIGHT_BG = (241, 245, 249)   # Slate-100
COLOR_TABLE_HEAD = (37, 99, 235)   # Blue-600
COLOR_TABLE_ALT = (248, 250, 252)  # Slate-50
COLOR_BLACK = (15, 23, 42)         # Slate-900
COLOR_WHITE = (255, 255, 255)
COLOR_BORDER = (203, 213, 225)     # Slate-300


class ManualPDF(FPDF):
    def __init__(self):
        super().__init__('P', 'mm', 'Letter')
        self.set_auto_page_break(auto=True, margin=20)
        self.toc_entries = []
        self.current_h1 = ""

    def header(self):
        if self.page_no() <= 1:
            return
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*COLOR_GRAY)
        self.cell(0, 8, "Manual de Usuario - Control de Obra", align="L")
        self.cell(0, 8, self.current_h1, align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*COLOR_BORDER)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(4)

    def footer(self):
        if self.page_no() <= 1:
            return
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*COLOR_GRAY)
        self.cell(0, 10, f"Pagina {self.page_no()}", align="C")

    def cover_page(self):
        self.add_page()
        self.ln(50)
        # Title
        self.set_font("Helvetica", "B", 32)
        self.set_text_color(*COLOR_PRIMARY)
        self.cell(0, 16, "Manual de Usuario", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(4)
        self.set_font("Helvetica", "B", 28)
        self.set_text_color(*COLOR_DARK)
        self.cell(0, 14, "Control de Obra", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(10)
        # Subtitle
        self.set_font("Helvetica", "", 14)
        self.set_text_color(*COLOR_GRAY)
        self.cell(0, 10, "Plataforma de Gestion Integral", align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 10, "para Empresas de Construccion", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(20)
        # Line separator
        self.set_draw_color(*COLOR_PRIMARY)
        self.set_line_width(0.8)
        cx = self.w / 2
        self.line(cx - 40, self.get_y(), cx + 40, self.get_y())
        self.ln(15)
        # Version info
        self.set_font("Helvetica", "", 11)
        self.set_text_color(*COLOR_GRAY)
        self.cell(0, 8, "Version 1.0  |  Febrero 2026", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(60)
        # Footer note
        self.set_font("Helvetica", "I", 9)
        self.cell(0, 8, "Documento generado automaticamente", align="C", new_x="LMARGIN", new_y="NEXT")

    def add_toc(self):
        self.add_page()
        self.current_h1 = "Contenidos"
        self.set_font("Helvetica", "B", 22)
        self.set_text_color(*COLOR_DARK)
        self.cell(0, 14, "Tabla de Contenidos", new_x="LMARGIN", new_y="NEXT")
        self.ln(6)

        for entry in self.toc_entries:
            level, title, page = entry
            if level == 1:
                self.set_font("Helvetica", "B", 11)
                self.set_text_color(*COLOR_PRIMARY)
                indent = 0
                self.ln(3)
            elif level == 2:
                self.set_font("Helvetica", "", 10)
                self.set_text_color(*COLOR_DARK)
                indent = 8
            else:
                self.set_font("Helvetica", "", 9)
                self.set_text_color(*COLOR_GRAY)
                indent = 16

            self.set_x(self.l_margin + indent)
            w = self.w - self.l_margin - self.r_margin - indent - 15
            self.cell(w, 6, title[:80], align="L")
            self.cell(15, 6, str(page), align="R", new_x="LMARGIN", new_y="NEXT")


def clean_text(text):
    """Remove markdown formatting and replace Unicode chars for latin-1 compat."""
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)  # bold
    text = re.sub(r'\*(.+?)\*', r'\1', text)        # italic
    text = re.sub(r'`(.+?)`', r'\1', text)          # code
    text = re.sub(r'\[(.+?)\]\(.+?\)', r'\1', text) # links
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    # Replace Unicode chars not in latin-1
    text = text.replace('\u2192', '->')   # →
    text = text.replace('\u2190', '<-')   # ←
    text = text.replace('\u2014', '--')   # —
    text = text.replace('\u2013', '-')    # –
    text = text.replace('\u2018', "'")    # '
    text = text.replace('\u2019', "'")    # '
    text = text.replace('\u201c', '"')    # "
    text = text.replace('\u201d', '"')    # "
    text = text.replace('\u2022', '-')    # •
    text = text.replace('\u2026', '...')  # …
    text = text.replace('\u00f1', 'n')    # ñ -> keep as n for safety
    text = text.replace('\ud83d', '')     # emoji prefix
    # Replace any remaining non-latin1 chars
    result = []
    for ch in text:
        try:
            ch.encode('latin-1')
            result.append(ch)
        except UnicodeEncodeError:
            result.append('?')
    return ''.join(result)


def parse_table(lines, start_idx):
    """Parse a markdown table starting at start_idx. Returns (rows, end_idx)."""
    rows = []
    i = start_idx
    while i < len(lines):
        line = lines[i].strip()
        if not line.startswith('|'):
            break
        # Skip separator rows
        if re.match(r'^\|[\s\-:|]+\|$', line):
            i += 1
            continue
        cells = [c.strip() for c in line.split('|')[1:-1]]
        rows.append(cells)
        i += 1
    return rows, i


def render_table(pdf, rows):
    """Render a table to PDF."""
    if not rows:
        return

    num_cols = len(rows[0])
    available_w = pdf.w - pdf.l_margin - pdf.r_margin
    col_w = available_w / num_cols

    # Adjust column widths based on content
    if num_cols <= 3:
        col_widths = [available_w / num_cols] * num_cols
    elif num_cols == 4:
        col_widths = [available_w * 0.22, available_w * 0.18, available_w * 0.18, available_w * 0.42]
    elif num_cols == 5:
        col_widths = [available_w * 0.20, available_w * 0.15, available_w * 0.15, available_w * 0.15, available_w * 0.35]
    elif num_cols == 6:
        col_widths = [available_w / 6] * 6
    else:
        col_widths = [available_w / num_cols] * num_cols

    # Ensure widths sum to available
    total = sum(col_widths)
    col_widths = [w * available_w / total for w in col_widths]

    row_h = 7

    for r_idx, row in enumerate(rows):
        # Check page break
        if pdf.get_y() + row_h > pdf.h - 25:
            pdf.add_page()

        if r_idx == 0:
            # Header row
            pdf.set_fill_color(*COLOR_TABLE_HEAD)
            pdf.set_text_color(*COLOR_WHITE)
            pdf.set_font("Helvetica", "B", 8)
        else:
            if r_idx % 2 == 0:
                pdf.set_fill_color(*COLOR_TABLE_ALT)
            else:
                pdf.set_fill_color(*COLOR_WHITE)
            pdf.set_text_color(*COLOR_BLACK)
            pdf.set_font("Helvetica", "", 8)

        x_start = pdf.get_x()
        max_lines = 1

        # Calculate row height based on content
        for c_idx, cell in enumerate(row):
            if c_idx < len(col_widths):
                cw = col_widths[c_idx]
            else:
                cw = col_widths[-1]
            text = clean_text(cell) if c_idx < len(row) else ""
            lines_needed = max(1, len(text) * pdf.get_string_width("a") / (cw - 2) + 1)
            max_lines = max(max_lines, int(lines_needed))

        actual_h = max(row_h, min(max_lines * 4, 20))

        for c_idx in range(num_cols):
            if c_idx < len(col_widths):
                cw = col_widths[c_idx]
            else:
                cw = col_widths[-1]

            text = clean_text(row[c_idx]) if c_idx < len(row) else ""

            # Truncate if too long
            while pdf.get_string_width(text) > cw - 3 and len(text) > 3:
                text = text[:-4] + "..."

            pdf.cell(cw, actual_h, text, border=1, fill=True)

        pdf.ln()

    pdf.ln(3)


def generate_pdf():
    pdf = ManualPDF()
    pdf.set_left_margin(18)
    pdf.set_right_margin(18)

    # Cover page
    pdf.cover_page()

    # Read markdown
    with open(INPUT_MD, "r", encoding="utf-8") as f:
        content = f.read()

    lines = content.split("\n")

    # First pass: collect TOC entries (we'll fill page numbers later)
    toc_data = []

    # Skip the title block and TOC in markdown
    i = 0
    skip_toc = False
    content_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## Tabla de Contenidos"):
            skip_toc = True
            continue
        if skip_toc:
            if stripped.startswith("# ") or (stripped.startswith("---") and not stripped.startswith("---\n")):
                if stripped.startswith("# "):
                    skip_toc = False
                    content_lines.append(line)
                elif stripped == "---":
                    skip_toc = False
                continue
            continue
        # Skip the first title and subtitle
        if stripped == "# Manual de Usuario - Control de Obra":
            continue
        if stripped.startswith("**Plataforma de Gestion"):
            continue
        if stripped.startswith("Version 1.0"):
            continue
        content_lines.append(line)

    lines = content_lines

    # Render content
    pdf.add_page()
    i = 0
    in_blockquote = False
    blockquote_text = ""

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip empty lines
        if not stripped:
            i += 1
            continue

        # Horizontal rule
        if stripped == "---":
            pdf.set_draw_color(*COLOR_BORDER)
            pdf.line(pdf.l_margin, pdf.get_y() + 2, pdf.w - pdf.r_margin, pdf.get_y() + 2)
            pdf.ln(6)
            i += 1
            continue

        # H1 - Part headers
        if stripped.startswith("# "):
            title = stripped[2:].strip()
            pdf.current_h1 = title[:50]
            pdf.add_page()
            pdf.toc_entries.append((1, title, pdf.page_no()))
            pdf.ln(10)
            pdf.set_font("Helvetica", "B", 24)
            pdf.set_text_color(*COLOR_PRIMARY)
            pdf.multi_cell(0, 12, clean_text(title))
            pdf.set_draw_color(*COLOR_PRIMARY)
            pdf.set_line_width(0.6)
            pdf.line(pdf.l_margin, pdf.get_y() + 2, pdf.l_margin + 60, pdf.get_y() + 2)
            pdf.ln(8)
            i += 1
            continue

        # H2 - Section headers
        if stripped.startswith("## "):
            title = stripped[3:].strip()
            pdf.toc_entries.append((2, title, pdf.page_no()))
            if pdf.get_y() > pdf.h - 50:
                pdf.add_page()
            pdf.ln(6)
            pdf.set_font("Helvetica", "B", 16)
            pdf.set_text_color(*COLOR_DARK)
            pdf.multi_cell(0, 10, clean_text(title))
            pdf.set_draw_color(*COLOR_PRIMARY)
            pdf.set_line_width(0.3)
            pdf.line(pdf.l_margin, pdf.get_y() + 1, pdf.l_margin + 40, pdf.get_y() + 1)
            pdf.ln(5)
            i += 1
            continue

        # H3 - Subsection headers
        if stripped.startswith("### "):
            title = stripped[4:].strip()
            pdf.toc_entries.append((3, title, pdf.page_no()))
            if pdf.get_y() > pdf.h - 40:
                pdf.add_page()
            pdf.ln(4)
            pdf.set_font("Helvetica", "B", 13)
            pdf.set_text_color(*COLOR_DARK)
            pdf.multi_cell(0, 8, clean_text(title))
            pdf.ln(3)
            i += 1
            continue

        # H4
        if stripped.startswith("#### "):
            title = stripped[5:].strip()
            if pdf.get_y() > pdf.h - 35:
                pdf.add_page()
            pdf.ln(3)
            pdf.set_font("Helvetica", "B", 11)
            pdf.set_text_color(*COLOR_PRIMARY)
            pdf.multi_cell(0, 7, clean_text(title))
            pdf.ln(2)
            i += 1
            continue

        # Table
        if stripped.startswith("|"):
            rows, end_idx = parse_table(lines, i)
            if rows:
                render_table(pdf, rows)
            i = end_idx
            continue

        # Blockquote
        if stripped.startswith("> "):
            bq_text = stripped[2:]
            i += 1
            while i < len(lines) and lines[i].strip().startswith("> "):
                bq_text += " " + lines[i].strip()[2:]
                i += 1

            if pdf.get_y() > pdf.h - 30:
                pdf.add_page()

            pdf.set_fill_color(254, 249, 195)  # Yellow-100
            pdf.set_draw_color(234, 179, 8)     # Yellow-500
            x = pdf.get_x()
            y = pdf.get_y()

            pdf.set_font("Helvetica", "I", 9)
            pdf.set_text_color(*COLOR_DARK)

            # Draw background
            text = clean_text(bq_text)
            w = pdf.w - pdf.l_margin - pdf.r_margin - 6
            # Estimate height
            char_w = pdf.get_string_width("a")
            est_lines = max(1, int(len(text) * char_w / w) + 1)
            h = max(12, est_lines * 5 + 6)

            pdf.set_x(pdf.l_margin + 3)
            pdf.rect(pdf.l_margin, y, w + 6, h, style="DF")
            pdf.set_line_width(0.5)
            pdf.line(pdf.l_margin, y, pdf.l_margin, y + h)
            pdf.set_x(pdf.l_margin + 6)
            pdf.multi_cell(w - 3, 5, text)
            pdf.set_y(max(pdf.get_y(), y + h) + 2)
            pdf.ln(2)
            continue

        # Code block
        if stripped.startswith("```"):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing ```

            if code_lines:
                if pdf.get_y() > pdf.h - 30:
                    pdf.add_page()
                pdf.set_fill_color(*COLOR_LIGHT_BG)
                pdf.set_font("Courier", "", 8)
                pdf.set_text_color(*COLOR_DARK)

                code_text = "\n".join(code_lines)
                y_start = pdf.get_y()
                pdf.set_x(pdf.l_margin + 2)

                for cl in code_lines:
                    if pdf.get_y() > pdf.h - 20:
                        pdf.add_page()
                    pdf.set_x(pdf.l_margin + 4)
                    text = cl.replace('\t', '    ')
                    if len(text) > 90:
                        text = text[:87] + "..."
                    pdf.cell(pdf.w - pdf.l_margin - pdf.r_margin - 4, 4.5, text, fill=True, new_x="LMARGIN", new_y="NEXT")

                pdf.ln(3)
            continue

        # Bullet list
        if stripped.startswith("- ") or stripped.startswith("* "):
            items = []
            while i < len(lines):
                s = lines[i].strip()
                if s.startswith("- ") or s.startswith("* "):
                    indent = len(lines[i]) - len(lines[i].lstrip())
                    items.append((indent, s[2:]))
                    i += 1
                elif s and not s.startswith("#") and not s.startswith("|") and not s.startswith(">") and not s.startswith("```"):
                    # Continuation of previous item
                    if items:
                        items[-1] = (items[-1][0], items[-1][1] + " " + s)
                    i += 1
                else:
                    break

            for indent, item in items:
                if pdf.get_y() > pdf.h - 20:
                    pdf.add_page()
                level = min(indent // 2, 3)
                x_offset = pdf.l_margin + 4 + level * 6

                pdf.set_x(x_offset)
                pdf.set_font("Helvetica", "", 9)
                pdf.set_text_color(*COLOR_DARK)

                bullet = "  " if level > 0 else "  "
                text = clean_text(item)
                w = pdf.w - x_offset - pdf.r_margin

                # Check for bold prefix (like "**Campo:** valor")
                bold_match = re.match(r'^(.+?):\s*(.*)$', text)

                pdf.set_x(x_offset - 3)
                pdf.set_font("Helvetica", "", 9)
                pdf.cell(3, 5, bullet)

                if bold_match and len(bold_match.group(1)) < 40:
                    pdf.set_font("Helvetica", "B", 9)
                    pdf.cell(pdf.get_string_width(bold_match.group(1) + ": ") + 1, 5, bold_match.group(1) + ": ")
                    pdf.set_font("Helvetica", "", 9)
                    remaining = bold_match.group(2)
                    if remaining:
                        avail = w - pdf.get_string_width(bold_match.group(1) + ": ") - 5
                        if pdf.get_string_width(remaining) > avail:
                            pdf.cell(avail, 5, "", new_x="LMARGIN", new_y="NEXT")
                            pdf.set_x(x_offset + 3)
                            pdf.multi_cell(w - 6, 5, remaining)
                        else:
                            pdf.cell(0, 5, remaining, new_x="LMARGIN", new_y="NEXT")
                    else:
                        pdf.ln(5)
                else:
                    if pdf.get_string_width(text) > w - 5:
                        pdf.multi_cell(w - 3, 5, text)
                    else:
                        pdf.cell(w - 3, 5, text, new_x="LMARGIN", new_y="NEXT")

            pdf.ln(2)
            continue

        # Numbered list
        if re.match(r'^\d+\.\s', stripped):
            items = []
            while i < len(lines):
                s = lines[i].strip()
                m = re.match(r'^(\d+)\.\s(.+)', s)
                if m:
                    items.append((m.group(1), m.group(2)))
                    i += 1
                elif s and not s.startswith("#") and not s.startswith("|") and not s.startswith(">") and not s.startswith("```") and not s.startswith("- "):
                    if items:
                        items[-1] = (items[-1][0], items[-1][1] + " " + s)
                    i += 1
                else:
                    break

            for num, item in items:
                if pdf.get_y() > pdf.h - 20:
                    pdf.add_page()
                pdf.set_x(pdf.l_margin + 4)
                pdf.set_font("Helvetica", "B", 9)
                pdf.set_text_color(*COLOR_PRIMARY)
                pdf.cell(8, 5, f"{num}.")
                pdf.set_font("Helvetica", "", 9)
                pdf.set_text_color(*COLOR_DARK)
                text = clean_text(item)
                w = pdf.w - pdf.l_margin - pdf.r_margin - 14
                if pdf.get_string_width(text) > w:
                    pdf.multi_cell(w, 5, text)
                else:
                    pdf.cell(w, 5, text, new_x="LMARGIN", new_y="NEXT")

            pdf.ln(2)
            continue

        # Regular paragraph
        if stripped:
            if pdf.get_y() > pdf.h - 20:
                pdf.add_page()

            text = clean_text(stripped)

            # Check if bold paragraph
            if stripped.startswith("**") and stripped.endswith("**"):
                pdf.set_font("Helvetica", "B", 10)
                pdf.set_text_color(*COLOR_DARK)
                text = text
            else:
                pdf.set_font("Helvetica", "", 10)
                pdf.set_text_color(*COLOR_DARK)

            # Collect continuation lines
            i += 1
            while i < len(lines):
                s = lines[i].strip()
                if not s or s.startswith("#") or s.startswith("|") or s.startswith(">") or s.startswith("```") or s.startswith("- ") or s.startswith("* ") or re.match(r'^\d+\.\s', s):
                    break
                text += " " + clean_text(s)
                i += 1

            pdf.multi_cell(0, 5.5, text)
            pdf.ln(2)
            continue

        i += 1

    # Now insert TOC after cover
    # We'll generate a temporary TOC page count then rebuild
    # For simplicity, just output without inserting TOC in middle

    pdf.output(OUTPUT_PDF)
    print(f"PDF generado: {OUTPUT_PDF}")
    print(f"Paginas: {pdf.page_no()}")


if __name__ == "__main__":
    generate_pdf()
