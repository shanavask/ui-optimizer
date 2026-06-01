# %%
from browser_use import Agent, Browser, ChatGoogle
from browserbase import Browserbase, BrowserbaseError

import os
# %%
GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT")
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION")
LLM_MODEL = os.getenv("LLM_MODEL")
BROWSERBASE_API_KEY = os.getenv("BROWSERBASE_API_KEY")
BROWSERBASE_PROJECT_ID = os.getenv("BROWSERBASE_PROJECT_ID")
# %%
def create_browserbase_session() -> str:
    """
    Creates a Browserbase session and returns its connect URL.
    """
    if not BROWSERBASE_API_KEY:
        raise ValueError("BROWSERBASE_API_KEY is missing.")
    if not BROWSERBASE_PROJECT_ID:
        raise ValueError("BROWSERBASE_PROJECT_ID is missing.")

    bb = Browserbase(api_key=BROWSERBASE_API_KEY)
    session = bb.sessions.create(project_id=BROWSERBASE_PROJECT_ID)
    connect_url = session.connect_url
    if not connect_url:
        raise ValueError("Browserbase session did not return connectUrl.")
    return connect_url

def browser_agent(task: str, model: str) -> Agent:
    """
    Create and return a browser-use Agent for the given task.
    Arguments:
        task: The task description for the agent.
    Returns:
        Agent: The configured browser-use Agent.
    """
    try:
        connect_url = create_browserbase_session()
    except (BrowserbaseError, ValueError) as error:
        raise RuntimeError(f"Browserbase session could not be created: {error}") from error


    use_agent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"
    viewport = {"width": 393, "height": 852}
    device_scale_factor = 3
    browser = Browser(
        headless=True,
        # cdp_url=f"wss://{env.CDP_URL}",
        cdp_url=connect_url,
        user_agent=use_agent,
        viewport=viewport,
        window_size=viewport,
        device_scale_factor=device_scale_factor,
    )

    resolved_model = model or LLM_MODEL
    if not resolved_model:
        raise ValueError("No model configured. Set request model or LLM_MODEL env var.")

    llm = ChatGoogle(
        model=resolved_model,
        vertexai=True,
        project=GOOGLE_CLOUD_PROJECT,
        location=GOOGLE_CLOUD_LOCATION,
    )

    agent = Agent(task=task, llm=llm, browser=browser)
    return agent
# %%
task = """"Go to https://www.footlocker.com/product/adidas-originals-handball-spezial-womens/KJ0090.html and evaluate the page for the following UX best practices.
You have access to a iPhone 15 Pro browser environment to navigate and interact with the webpage.
    
Criteria to evaluate:
1. Implement high-resolution imagery and 360-degree views, including lifestyle shots, to accurately showcase the product from all angles and contexts.
2. Ensure the 'Add to Cart' button is prominently displayed, uses a contrasting color, and remains visible as the user scrolls, emphasizing its primary call to action.
3. Provide a comprehensive sizing guide, fit recommendations, and customer-generated fit feedback to reduce uncertainty and returns for apparel and footwear.
4. Integrate customer reviews, ratings, and user-generated content (UGC) to build trust and provide social proof, helping potential buyers make informed decisions.
5. Offer clear, concise product descriptions highlighting key features, materials, and benefits, while also providing quick access to more detailed specifications.
6. Include a 'Frequently Bought Together' or 'Complete the Look' section to suggest complementary items, increasing average order value and user engagement.
7. Clearly communicate shipping costs, delivery estimates, and return policies early in the product detail page experience to manage expectations and reduce cart abandonment.
"""
agent = browser_agent(task, LLM_MODEL)

# %%
history = await agent.run()
# %%
result = history.final_result()
# %%
result
# %%