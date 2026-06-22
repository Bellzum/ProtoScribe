from __future__ import annotations

from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .models import SessionRecord


def build_pdf_report(session: SessionRecord) -> bytes:
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )

    styles = getSampleStyleSheet()
    title_style = styles["Title"]
    heading_style = styles["Heading2"]
    body_style = styles["BodyText"]
    mono_style = ParagraphStyle(
        "Mono",
        parent=body_style,
        fontName="Courier",
        fontSize=9,
        leading=12,
    )

    story = [
        Paragraph("ProtoScribe Session Report", title_style),
        Spacer(1, 0.2 * inch),
        Paragraph(f"Session ID: {session.session_id}", mono_style),
        Paragraph(f"Protocol: {session.protocol_name}", body_style),
        Paragraph(f"Started: {session.started_at}", body_style),
        Paragraph(f"Ended: {session.ended_at or 'In progress'}", body_style),
        Paragraph(
            f"Confirmation Required: {'Yes' if session.confirmation_required else 'No'}",
            body_style,
        ),
        Spacer(1, 0.2 * inch),
        Paragraph("Step Timeline", heading_style),
        Spacer(1, 0.1 * inch),
    ]

    if session.step_events:
        rows = [["Timestamp", "Step", "Event", "Detail"]]
        for event in sorted(session.step_events, key=lambda item: item.timestamp):
            rows.append(
                [
                    event.timestamp,
                    f"{event.step_index}. {event.step_title}",
                    event.event_type,
                    event.detail or "",
                ]
            )

        timeline_table = Table(rows, repeatRows=1, colWidths=[1.5 * inch, 2.1 * inch, 1.1 * inch, 2.1 * inch])
        timeline_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.black),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        story.append(timeline_table)
    else:
        story.append(Paragraph("No step events recorded.", body_style))

    story.extend(
        [
            Spacer(1, 0.25 * inch),
            Paragraph("Observations", heading_style),
            Spacer(1, 0.1 * inch),
        ]
    )

    if session.observations:
        for note in sorted(session.observations, key=lambda item: item.timestamp):
            story.extend(
                [
                    Paragraph(
                        f"{note.timestamp} · Step {note.step_index} · {note.step_title}",
                        mono_style,
                    ),
                    Paragraph(note.transcript, body_style),
                    Spacer(1, 0.12 * inch),
                ]
            )
    else:
        story.append(Paragraph("No observations were captured.", body_style))

    document.build(story)
    return buffer.getvalue()
