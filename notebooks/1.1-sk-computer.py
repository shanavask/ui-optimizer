# %%
import sys
sys.path.append("../apis/computer-use")
from agent import BrowserAgent
from computers import BrowserbaseComputer
import base64
# %%
initial_url = "https://www.footlocker.com/product/adidas-originals-handball-spezial-womens/KJ0090.html"
task = """"Go to {initial_url} and evaluate the page for the following UX best practices.    

Criteria to evaluate:
1. Implement high-resolution imagery and 360-degree views, including lifestyle shots, to accurately showcase the product from all angles and contexts.
2. Ensure the 'Add to Cart' button is prominently displayed, uses a contrasting color, and remains visible as the user scrolls, emphasizing its primary call to action.
3. Provide a comprehensive sizing guide, fit recommendations, and customer-generated fit feedback to reduce uncertainty and returns for apparel and footwear.
4. Integrate customer reviews, ratings, and user-generated content (UGC) to build trust and provide social proof, helping potential buyers make informed decisions.
5. Offer clear, concise product descriptions highlighting key features, materials, and benefits, while also providing quick access to more detailed specifications.
6. Include a 'Frequently Bought Together' or 'Complete the Look' section to suggest complementary items, increasing average order value and user engagement.
7. Clearly communicate shipping costs, delivery estimates, and return policies early in the product detail page experience to manage expectations and reduce cart abandonment.
"""
task = """make sure the page loads correctly"""
# %%
VIEWPORT = (440, 956)
CHROME_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "CriOS/135.0.0.0 Mobile/15E148 Safari/604.1"
)

env = BrowserbaseComputer(
            screen_size=VIEWPORT,
            chrome_ua=CHROME_UA,
            initial_url=initial_url
        )
# %%
# COMPUTER_MODEL = 'gemini-2.5-computer-use-preview-10-2025'
COMPUTER_MODEL = 'gemini-3-flash-preview'
with env as browser_computer:
    agent = BrowserAgent(
        browser_computer=browser_computer,
        query=task,
        model_name=COMPUTER_MODEL,
    )
    agent.agent_loop()
    screenshot_base64 = browser_computer._screenshot()
    open("screenshot.png", "wb").write(base64.b64decode(screenshot_base64))
# %%
import base64
scren = open("screenshot.png", "rb").read()
print(base64.b64encode(scren).decode("utf-8"))
# %%
# import browserbase
# from playwright.async_api import async_playwright
# import os


# playwright = await async_playwright().start()
# browserbase = browserbase.Browserbase(
#     api_key=os.environ["BROWSERBASE_API_KEY"]
# )
# # %%

# session = browserbase.sessions.create(
#     project_id=os.environ["BROWSERBASE_PROJECT_ID"],
#     browser_settings={
#         "fingerprint": {
#             "screen": {
#                 "maxWidth": VIEWPORT[0],
#                 "maxHeight": VIEWPORT[1],
#                 "minWidth": VIEWPORT[0],
#                 "minHeight": VIEWPORT[1],
#             },
#             "navigator": {
#                 "userAgent": CHROME_UA,
#                 "platform": "iPhone",
#             },
#         },
#         "viewport": {
#             "width": VIEWPORT[0],
#             "height": VIEWPORT[1],
#         },
#     },
# )

# # %%
# browser = await playwright.chromium.connect_over_cdp(
#     session.connect_url
# )
# # %%
# initial_url = "https://www.footlocker.com/product/adidas-originals-handball-spezial-womens/KJ0090.html"
# context = browser.contexts[0]
# page = context.pages[0]
# await page.goto(initial_url)

# # context.on("page", handle_new_page)
# # %%
# import base64
# screenshot_path = "../data/iphone-17-pro-max-viewport.png"
# await page.add_style_tag(
#     content="""
#     *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
#     * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
#     """
# )
# await page.evaluate("window.scrollTo(0, 0)")
# screenshot_bytes = await page.screenshot(full_page=False)
# screenshot_base64 = base64.b64encode(screenshot_bytes).decode("utf-8")

# # %%
# f"https://browserbase.com/sessions/{session.id}"
# # %%
# await page.close()
# context.close()
# browser.close()
# await playwright.stop()
# # %%
# page
# # %%
