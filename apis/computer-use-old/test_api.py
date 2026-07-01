import unittest
from unittest.mock import MagicMock, patch

from fastapi import BackgroundTasks

import api


class TestApi(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        api.task_records.clear()
        api.task_counter = 0

    async def test_run_task_post_enqueues_task_only(self) -> None:
        request = api.TaskRequest(task="open docs", initial_url="https://example.com")
        background_tasks = BackgroundTasks()

        response = await api.run_task_post(request, background_tasks)

        self.assertEqual(response.task_id, "1")
        self.assertEqual(len(background_tasks.tasks), 1)
        queued_task = background_tasks.tasks[0]
        self.assertEqual(queued_task.args, ("1", "open docs", "https://example.com"))

    async def test_run_task_post_uses_caller_task_id(self) -> None:
        request = api.TaskRequest(
            task="open docs",
            initial_url="https://example.com",
            task_id="run_123:1",
        )
        background_tasks = BackgroundTasks()

        response = await api.run_task_post(request, background_tasks)

        self.assertEqual(response.task_id, "run_123:1")
        self.assertEqual(len(background_tasks.tasks), 1)
        queued_task = background_tasks.tasks[0]
        self.assertEqual(queued_task.args, ("run_123:1", "open docs", "https://example.com"))

    @patch("api.BrowserAgent")
    @patch("api.BrowserbaseComputer")
    @patch("api._save_audit_to_firestore")
    async def test_run_task_uses_default_model(
        self,
        mock_save_audit_to_firestore: MagicMock,
        mock_browserbase_computer: MagicMock,
        mock_browser_agent: MagicMock,
    ) -> None:
        browser_computer = MagicMock()
        mock_browserbase_computer.return_value.__enter__.return_value = browser_computer
        mock_browser_agent.return_value.final_reasoning = "done"

        await api.run_task("1", "check dashboard", "https://example.com")

        mock_browserbase_computer.assert_called_once_with(
            screen_size=(1440, 900),
            initial_url="https://example.com",
        )
        mock_browser_agent.assert_called_once_with(
            browser_computer=browser_computer,
            query="check dashboard",
            model_name=api.DEFAULT_MODEL,
        )
        mock_save_audit_to_firestore.assert_called_once_with("1", "done", None)
