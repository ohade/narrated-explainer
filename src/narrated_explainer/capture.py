"""Fresh offline browser capture; never reads a user profile."""
from pathlib import Path
import time
from urllib.parse import urlsplit

from playwright.sync_api import Error, TimeoutError, sync_playwright

CAPTURE_CSS = """
body.nx-page { padding: 0 !important; margin: 0 !important; }
body.nx-page > :not(figure.nx) { display: none !important; }
figure.nx { margin: 0 !important; max-width: none !important; }
figure.nx .nx-stage { max-width: none !important; }
figure.nx .nx-bar { position: static !important; }
"""
VIDEO_CSS = "figure.nx .nx-controls { display: none !important; }"
WAIT_MS = 30000


def launch_browser(playwright):
    try:
        return playwright.chromium.launch(headless=True, timeout=WAIT_MS)
    except (Error, RuntimeError) as error:
        if "Executable doesn't exist" in str(error):
            raise RuntimeError("Chromium is missing; run uv run playwright install chromium or rerun setup.sh") from error
        raise RuntimeError(f"Chromium launch failed: {error}") from error


class Capture:
    """Own a launch/context and track denied requests and browser errors."""

    def __init__(self, path: Path, width: int = 1280, scheme: str = "light"):
        self.path, self.width, self.scheme = Path(path), width, scheme
        self.errors = []
        self.browser = None
        self.playwright = None

    def __enter__(self):
        self.playwright = sync_playwright().start()
        try:
            self.browser = launch_browser(self.playwright)
            context = self.browser.new_context(viewport={"width": self.width, "height": 1000},
                                               device_scale_factor=1, color_scheme=self.scheme,
                                               service_workers="block")
            context.set_default_timeout(WAIT_MS)
            context.route("**/*", self._route)
            context.route_web_socket("**/*", self._deny_socket)
            self.page = context.new_page()
            self.page.on("pageerror", lambda error: self.errors.append(f"Page error: {error}"))
            self.page.on("console", self._console)
            self.page.goto(self.path.resolve().as_uri(), wait_until="load", timeout=WAIT_MS)
            self.check_errors()
            deadline = time.monotonic() + WAIT_MS / 1000
            while not self.page.evaluate("Boolean(window.NarratedExplainer && NarratedExplainer.players.length > 0)"):
                self.check_errors()
                if time.monotonic() >= deadline:
                    raise RuntimeError("Player API did not become ready within 30 seconds")
                self.page.wait_for_timeout(20)
            self.page.add_style_tag(content=CAPTURE_CSS + f"figure.nx {{ width: {self.width}px !important; }}")
            self.figure = self.page.locator("figure.nx")
            self.check_errors()
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *args):
        try:
            if self.browser is not None:
                self.browser.close()
        finally:
            if self.playwright is not None:
                self.playwright.stop()

    def _route(self, route):
        scheme = urlsplit(route.request.url).scheme
        if scheme in ("file", "data"):
            route.continue_()
        else:
            self.errors.append(f"Blocked network request ({scheme})")
            route.abort()

    def _deny_socket(self, socket):
        self.errors.append("Blocked network request (WebSocket)")
        # A routed socket never connects unless connect_to_server() is called.
        # Leave it disconnected; command failure closes the entire context.

    def _console(self, message):
        if message.type == "error":
            self.errors.append(f"Console error: {message.text}")

    def check_errors(self) -> None:
        if self.errors:
            raise RuntimeError("; ".join(self.errors))

    def call(self, method: str, *args):
        self.check_errors()
        try:
            result = self._evaluate_call(method, args)
        except TimeoutError as error:
            raise RuntimeError(f"Player API timed out: {method}") from error
        except Error as error:
            raise RuntimeError(f"Player API {method} failed: {error}") from error
        self.check_errors()
        return result

    def _evaluate_call(self, method, args):
        # The driver deadline still fires if authored drawing blocks the renderer.
        # A truthy wrapper prevents polling from repeating void-returning methods.
        handle = self.page.wait_for_function("""async ([method, args]) => {
          return {value: await NarratedExplainer.players[0][method](...args)};
        }""", arg=[method, args], timeout=WAIT_MS)
        try:
            return handle.json_value().get("value")
        finally:
            handle.dispose()

    def caption(self) -> str:
        text = self.figure.locator("figcaption").inner_text()
        self.check_errors()
        return text

    def screenshot(self) -> bytes:
        self.check_errors()
        image = self.figure.screenshot(type="png", animations="disabled", timeout=WAIT_MS)
        self.check_errors()
        return image

    def prepare_video(self, modes: list[str]) -> None:
        """Reserve the tallest caption; keep the progress markers visible."""
        self.page.add_style_tag(content=VIDEO_CSS)
        height = self.figure.locator("figcaption").bounding_box()["height"]
        for mode in modes:
            for index, _ in enumerate(self.call("positions", mode)):
                self.call("goto", mode, index)
                height = max(height, self.figure.locator("figcaption").bounding_box()["height"])
        self.page.add_style_tag(content=f"figure.nx figcaption {{ min-height: {height}px !important; }}")
        self.check_errors()
