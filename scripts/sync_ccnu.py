import os
import json
import requests
from bs4 import BeautifulSoup
from datetime import datetime

# 数据文件相对路径（相对于 Github 根目录）
DATA_FILE = "data/content.json"
# 华大教务处官网的“通知公告”专栏
CCNU_URL = "http://jwc.ccnu.edu.cn/index/tzgg.htm" 

def scrape_ccnu_notices():
    try:
        # 伪装自己是正常的浏览器访问
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        resp = requests.get(CCNU_URL, headers=headers, timeout=15)
        resp.encoding = 'utf-8'
        
        soup = BeautifulSoup(resp.text, "html.parser")
        
        extracted = []
        
        # 采用最基础和兼容易的寻径法（防脆弱）：抓取所有的 li 里的 a
        for li in soup.find_all('li'):
            a_tag = li.find('a')
            if not a_tag or not a_tag.text.strip():
                continue
                
            title = a_tag.text.strip()
            
            # 过滤掉标题过短的杂乱链接（例如 navbar 的链接）
            if len(title) < 6:
                continue
                
            # 尝试找时间（华师的结构通常在 span 中）
            date_str = ""
            spans = li.find_all('span')
            for span in spans:
                if '-' in span.text or '/' in span.text:
                    date_str = span.text.strip()
                    break
                    
            if not date_str:
                date_str = datetime.now().strftime("%Y-%m-%d")
            
            extracted.append({
                "title": title,
                "date": date_str,
                "category": "华师最新教务"
            })
            
            # 最多拿主页最新的 4 条
            if len(extracted) >= 4:
                break
                
        return extracted
    except Exception as e:
        print(f"Scraper error: {e}")
        return []

def main():
    if not os.path.exists(DATA_FILE):
        print(f"Error: {DATA_FILE} not found. Ensure script runs from root.")
        return
        
    print("Initiating scrape on JWC...")
    extracted_data = scrape_ccnu_notices()
    
    # 【安全阀】如果爬虫拿到的数据少于 2 条（意味着网站很可能改版了），拒绝覆盖源文件避免网站白屏
    if not extracted_data or len(extracted_data) < 2:
        print("Safety Abort: Extracted less than 2 items. Retaining original mock data.")
        return
        
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    data["announcements"] = extracted_data
    
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        
    print(f"Success: Updated {DATA_FILE} with {len(extracted_data)} fresh notices.")

if __name__ == "__main__":
    main()
