import os
import requests
from dotenv import load_dotenv

load_dotenv()

r = requests.get(
    "https://api.apify.com/v2/datasets/NXvLOzsTDMfVIfR5v/items"
    "?token=" + os.environ["APIFY_API_TOKEN"] + "&format=json&clean=true&limit=5"
)
for p in r.json():
    print(p.get("ownerUsername"), "|", (p.get("caption") or "")[:80])