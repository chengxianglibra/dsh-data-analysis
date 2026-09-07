"""Bounded errors without source values or transformation details."""


class PresentationDatasetError(ValueError):
    def __init__(self, code: str, path: str, message: str) -> None:
        super().__init__(f"{path or '/'}: {message}")
        self.code = code
        self.path = path
