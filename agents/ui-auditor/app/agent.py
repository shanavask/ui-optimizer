import os

import google.auth
from google.adk.agents import LlmAgent
from google.adk.agents.context import Context
from google.adk.apps import App
from google.adk.events.event import Event
from google.adk.workflow import Workflow
from google.genai import types

from .criteria_agent import criteria_agent
from .guestimate_agent import guestimate_agent

_, project_id = google.auth.default()
os.environ["GOOGLE_CLOUD_PROJECT"] = project_id
os.environ["GOOGLE_CLOUD_LOCATION"] = "global"
os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "True"



def capture_input(node_input: types.Content) -> Event:
    text = "".join(p.text for p in node_input.parts if hasattr(p, "text") and p.text)
    return Event(output=text, state={"user_input": text})


classify_issue = LlmAgent(
    name="classify_issue",
    model="gemini-flash-latest",
    instruction="""Classify the UI audit request into one or more of the following categories:
    "ACCESSIBILITY", "USABILITY", "VISUAL", "PERFORMANCE", "CRITERIA", "GUESTIMATE".
    Use "CRITERIA" when the user asks for best practices, guidelines, or audit criteria for a specific page type or vertical.
    Use "GUESTIMATE" when the user asks about traffic, engagement metrics, or web analytics estimates for a domain.
    If more than one category applies, reply with a comma-separated list.
    Reply with category names only, no explanation.
    """,
    output_schema=str,
)


def router(ctx: Context, node_input: str) -> Event:
    routes = [r.strip() for r in node_input.split(",")]
    return Event(output=ctx.state.get("user_input", ""), route=routes)


def handle_accessibility(user_input: str) -> Event:
    return Event(message=f"Auditing accessibility: WCAG compliance, color contrast, keyboard navigation, ARIA labels. Request: {user_input}")


def handle_usability(user_input: str) -> Event:
    return Event(message=f"Auditing usability: UX patterns, navigation flows, call-to-action clarity. Request: {user_input}")


def handle_visual(user_input: str) -> Event:
    return Event(message=f"Auditing visual design: spacing, typography, color scheme, design consistency. Request: {user_input}")


def handle_performance(user_input: str) -> Event:
    return Event(message=f"Auditing performance: asset sizes, load times, layout shifts, render-blocking resources. Request: {user_input}")


root_agent = Workflow(
    name="ui_audit_workflow",
    edges=[
        ("START", capture_input, classify_issue, router),
        (
            router,
            {
                "ACCESSIBILITY": handle_accessibility,
                "USABILITY": handle_usability,
                "VISUAL": handle_visual,
                "PERFORMANCE": handle_performance,
                "CRITERIA": criteria_agent,
                "GUESTIMATE": guestimate_agent,
            },
        ),
    ],
)

app = App(
    root_agent=root_agent,
    name="app",
)
