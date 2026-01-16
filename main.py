from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any
import uuid

app = FastAPI()

# 先全部開放 CORS，之後可以改成指定前端網址
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 暫時用記憶體存題目，之後可以換成資料庫
CARDS: Dict[str, Dict[str, Any]] = {}


class GradeRequest(BaseModel):
    card_id: str
    student_answer: str


@app.get("/ping")
async def ping():
    return {"message": "pong"}


@app.post("/cards")
async def create_card(
    subject: str = Form(...),
    question_text: str = Form(""),
    question_image_url: str = Form(""),
    answer_image_url: str = Form(...),
):
    """
    建立一題新題目：
    - subject：科目（statistics / economics / english...）
    - question_text：題目文字（可以先留空）
    - question_image_url：題目圖片網址（先用空字串）
    - answer_image_url：答案圖片網址（先用假網址）
    """
    card_id = str(uuid.uuid4())
    CARDS[card_id] = {
        "id": card_id,
        "subject": subject,
        "question_text": question_text or None,
        "question_image_url": question_image_url or None,
        "answer_image_url": answer_image_url,
        "solution_json": None,  # 之後 AI 讀答案圖片會填這裡
    }
    return {"card_id": card_id, "card": CARDS[card_id]}

from fastapi import HTTPException
from openai import OpenAI

client = OpenAI()

@app.post("/cards/{card_id}/generate-solution")
async def generate_solution(card_id: str):
    """
    使用 AI 讀取答案圖片，產生 solution_json（標準解答）
    """
    card = CARDS.get(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    answer_img = card["answer_image_url"]
    if not answer_img:
        raise HTTPException(status_code=400, detail="answer_image_url is missing")

    # 🧠 呼叫 OpenAI Vision
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "請閱讀這張答案圖片，幫我整理出題目的標準解答內容。" 
                     "請用 JSON 格式回覆，包含 final_answer、key_points、must_include、allow_variants。"},
                    {"type": "image_url", "image_url": {"url": answer_img}}
                ]
            }
        ]
    )

    # 取得 AI 回覆的文字
    solution_text = response.choices[0].message.content

    # 轉成 JSON
    import json
    try:
        solution_json = json.loads(solution_text)
    except:
        raise HTTPException(status_code=500, detail="AI 回傳不是有效 JSON 格式")

    # 存進記憶體
    card["solution_json"] = solution_json

    return {"card_id": card_id, "solution_json": solution_json}
