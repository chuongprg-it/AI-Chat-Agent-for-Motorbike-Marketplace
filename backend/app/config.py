import os
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

class Settings(BaseModel):
    PROJECT_NAME: str = "Vucar Motorbike Marketplace AI Agent"
    VERSION: str = "1.0.0"
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    DEFAULT_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    
    # Path calculation: app_dir is backend/app
    APP_DIR: str = os.path.dirname(os.path.abspath(__file__))
    BASE_DIR: str = os.path.dirname(APP_DIR)
    DATA_DIR: str = os.path.join(APP_DIR, "data")
    STATIC_DIR: str = os.path.join(APP_DIR, "static")
    
    MOCK_LISTINGS_FILE: str = os.path.join(DATA_DIR, "mock_listings.json")
    CHAT_HISTORY_FILE: str = os.path.join(DATA_DIR, "chat_history.jsonl")

settings = Settings()
