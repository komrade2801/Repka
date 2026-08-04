"""Import smoke for Linux/Docker after requirements install."""

from app.main import app
from app.mcp_tools import mcp

print("app_ok", app.title)
print("mcp_ok", getattr(mcp, "name", type(mcp)))
