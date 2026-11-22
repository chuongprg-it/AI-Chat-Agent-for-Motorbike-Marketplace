import uvicorn
import os
import sys

# Ensure current directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

if __name__ == "__main__":
    print("=" * 60)
    print("🚀 Vucar Motorbike Marketplace AI Chat Agent Prototype")
    print("✨ Frontend & API running at: http://127.0.0.1:8000")
    print("💡 Cùng kiến tạo niềm tin cho những giao dịch quan trọng nhất.")
    print("=" * 60)
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=False)
