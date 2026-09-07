import re
from pathlib import Path

import yaml

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def normalized(path: str) -> str:
    path = path.removeprefix("/api")
    return re.sub(r"\{[^}]+\}", "{}", path)


def operations(paths):
    return {
        (method, normalized(path))
        for path, item in paths.items()
        for method in item
        if method in HTTP_METHODS
    }


def test_fastapi_implements_every_static_openapi_operation(app):
    contract_path = Path(__file__).parents[2] / "openapi.yaml"
    contract = yaml.safe_load(contract_path.read_text())
    generated = app.openapi()

    assert operations(generated["paths"]) == operations(contract["paths"])
    assert len(operations(contract["paths"])) == 16
