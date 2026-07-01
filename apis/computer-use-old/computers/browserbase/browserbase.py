# Copyright 2025 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
import base64
import os
import termcolor
from ..playwright.playwright import PlaywrightComputer
import browserbase
from playwright.sync_api import sync_playwright


class BrowserbaseComputer(PlaywrightComputer):
    def __init__(
        self,
        screen_size: tuple[int, int],
        chrome_ua: str,
        initial_url: str = "https://www.google.com",
    ):
        super().__init__(screen_size, chrome_ua, initial_url)

    def __enter__(self):
        print("Creating session...")

        self._playwright = sync_playwright().start()
        self._browserbase = browserbase.Browserbase(
            api_key=os.environ["BROWSERBASE_API_KEY"]
        )

        self._session = self._browserbase.sessions.create(
            project_id=os.environ["BROWSERBASE_PROJECT_ID"],
            browser_settings={
                "fingerprint": {
                    "screen": {
                        "maxWidth": self._screen_size[0],
                        "maxHeight": self._screen_size[1],
                        "minWidth": self._screen_size[0],
                        "minHeight": self._screen_size[1],
                    },
                    "navigator": {
                        "userAgent": self._chrome_ua,
                        "platform": "iPhone",
                    },
                },
                "viewport": {
                    "width": self._screen_size[0],
                    "height": self._screen_size[1],
                },
            },
        )
        # self._session = self._browserbase.sessions.create(
        #     project_id=os.environ["BROWSERBASE_PROJECT_ID"],
        #     browser_settings={
        #         "fingerprint": {
        #             "screen": {
        #                 "maxWidth": 1920,
        #                 "maxHeight": 1080,
        #                 "minWidth": 1024,
        #                 "minHeight": 768,
        #             },
        #         },
        #         "viewport": {
        #             "width": self._screen_size[0],
        #             "height": self._screen_size[1],
        #         },
        #     },
        # )

        self._browser = self._playwright.chromium.connect_over_cdp(
            self._session.connect_url
        )
        self._context = self._browser.contexts[0]
        self._page = self._context.pages[0]
        self._page.goto(self._initial_url)

        self._context.on("page", self._handle_new_page)

        termcolor.cprint(
            f"Session started at https://browserbase.com/sessions/{self._session.id}",
            color="green",
            attrs=["bold"],
        )
        return self
    
    def _screenshot(self) -> str:
        self._page.reload(wait_until="networkidle")
        self._page.add_style_tag(
            content="""
            *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
            * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
            """
        )
        self._page.evaluate("window.scrollTo(0, 0)")
        self._page.wait_for_load_state("networkidle")
        screenshot_bytes = self._page.screenshot(type="png", full_page=False)
        return base64.b64encode(screenshot_bytes).decode("utf-8")


    def __exit__(self, exc_type, exc_val, exc_tb):
        self._page.close()

        if self._context:
            self._context.close()

        if self._browser:
            self._browser.close()

        self._playwright.stop()
