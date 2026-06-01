# %%
import os
import json
from google.cloud import firestore
# %%
project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
database_id = os.getenv("FIRESTORE_DATABASE_ID", "").strip()
location = os.getenv("GOOGLE_CLOUD_LOCATION", "").strip()
model = os.getenv("LLM_MODEL", "").strip()
# %%
client = firestore.Client(project=project_id, database=database_id)
# %%
task_id = 'fLx9dMMP5Gerd4BJAMmQ_page_0'
page_id = int(task_id.split('_')[-1])
# %%
from googleapiclient.discovery import build
from google.oauth2.service_account import Credentials
from google.cloud.secretmanager import SecretManagerServiceClient
from datetime import datetime

GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
SERVICE_SECRET = os.getenv("SERVICE_SECRET", "").strip()
TARGET_FOLDER_KEY = os.getenv("TARGET_FOLDER_KEY", "").strip()
TEMPLATE_FILE_KEY = os.getenv("TEMPLATE_FILE_KEY", "").strip()
# %%
page_id = int(task_id.split('_')[-1])
doc = client.collection("runs").document(task_id.split('_')[0]).get()
report = {u:doc.to_dict()['audit'].get(u, '') for u in ['vertical', 'company_name']}
report['page'] = doc.to_dict()['audit']['pages'][page_id]
doc = client.collection("roi").document(task_id.split('_')[0]).get()
report['guestimate'] = doc.to_dict().get('content', '')    

doc = client.collection("audits").document(task_id).get()
report['audit'] = doc.to_dict()['result']
# %%
from currency_converter import CurrencyConverter
from babel.numbers import format_currency
# %%
json_report = client.collection("reports").document('CT8Yk77CQopJRa8jQpcS_page_0').get().to_dict()
json_report
# %%
roi_calc = json_report['media_metrics']

ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref.zip'
c = CurrencyConverter(ECB_URL)
media_transactions = roi_calc.get('media_transactions', 0)
media_traffic = roi_calc.get('media_traffic', 0)
revenue_per_sale = roi_calc.get('revenue_per_sale', 0)
currency = roi_calc.get('currency', 'USD')
media_spend = roi_calc.get('media_spend', 0)
currency
# %%
media_revenue = media_transactions * revenue_per_sale
current_cvr = media_transactions / media_traffic
cvr_lift = 0.02 * 7
projected_cvr = current_cvr * (1 + cvr_lift)
revenue_opp = projected_cvr * media_traffic * revenue_per_sale - media_revenue    
cost_per_month = c.convert(12.5e3, 'USD', currency)
roi = (revenue_opp - cost_per_month * 12)
annual_cost = cost_per_month * 12
# %%

# %%
cvr_lift = round(cvr_lift, 2)
media_spend = format_currency(media_spend, currency, u'¤¤ #,##0', locale='en_US')
media_spend = '.'.join(media_spend.split('.')[:-1])
media_revenue = format_currency(media_revenue, currency, u'¤¤ #,##0', locale='en_US')
media_revenue = '.'.join(media_revenue.split('.')[:-1])

current_cvr = f"{current_cvr:.2f}%"
projected_cvr = f"{projected_cvr:.2f}%"
revenue_opp = format_currency(revenue_opp, currency, u'¤¤ #,##0', locale='en_US')
revenue_opp = '.'.join(revenue_opp.split('.')[:-1])
annual_cost = format_currency(annual_cost, currency, u'¤¤ #,##0', locale='en_US')
annual_cost = '.'.join(annual_cost.split('.')[:-1])
roi = format_currency(roi, currency, u'¤¤ #,##0', locale='en_US')
roi = '.'.join(roi.split('.')[:-1])
# %%
media_spend
# %%
