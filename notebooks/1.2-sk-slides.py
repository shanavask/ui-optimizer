# %%
import os
import json
from google.cloud import firestore
import base64
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
from googleapiclient.http import MediaFileUpload
from google.oauth2.service_account import Credentials
from google.cloud.secretmanager import SecretManagerServiceClient
from datetime import datetime

GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
SERVICE_SECRET = os.getenv("SERVICE_SECRET", "").strip()
TARGET_FOLDER_KEY = os.getenv("TARGET_FOLDER_KEY", "").strip()
TEMPLATE_FILE_KEY = os.getenv("TEMPLATE_FILE_KEY", "").strip()
# %%
TEMPLATE_FILE_KEY = '1fNTLOrXjA6GNjZCApepzTCTDYFItHeqDGHxmyTS3hEU'
# %%
run_id = '0Diu3gVcxEz1PL3QQrkx'
run_doc = client.collection("runs").document(run_id).get().to_dict()
num_pages = len(run_doc['audit']['pages'])
task_ids = [f"{run_id}_page_{pid}" for pid in range(num_pages)]
task_ids
# %%
copied_file = copy_audit_slide(task_ids)
# # %%
# task_ids = [task_id]
# doc = _get_json_report_from_firestore(task_ids[0])
# client = doc.get('clientName')
# vertical = doc.get('vertical')
# client
# # %%
# creds = get_creds()
# slides_service = build("slides", "v1", credentials=creds)
# presentation_id = '1HWD0tYDmFEFtXXjAJr9qo-IkKODbFjmB80HSE6f3ZWg'
# presentation = slides_service.presentations().get(presentationId=presentation_id).execute()
# slides = presentation.get("slides")
# %%
presentation_id = copied_file.get('id')

for task_id in task_ids:
    status = create_slide_for_key(task_id, copied_file)

# %%
status = update_roi_slide(presentation_id, task_id)    
# except Exception as e:
#     return f"Error in updating ROI slide {str(e)}"

# slides_url = f"https://docs.google.com/presentation/d/{presentation_id}/"
# %%
task_id = task_ids[0]
json_report = _get_json_report_from_firestore(task_id)
audit_doc = _get_doc_from_firestore("audits", task_id)
eyequant_doc = _get_doc_from_firestore("eyequant", task_id)
screenshot = audit_doc.get('screenshot')
eyeshot = eyequant_doc.get('eyeshot')
clarity = eyequant_doc.get('clarity')

def _download_gcs(gs_path: str, local_path: str) -> None:
    without_scheme = gs_path[len("gs://"):]
    bucket_name, blob_path = without_scheme.split("/", 1)
    storage.Client().bucket(bucket_name).blob(blob_path).download_to_filename(local_path)

def _write_image(value: str, local_path: str) -> None:
    if value.startswith("gs://"):
        _download_gcs(value, local_path)
    else:
        open(local_path, 'wb').write(base64.b64decode(value))
client = json_report.get('clientName')
page_type = json_report.get('page_type')
vertical = json_report.get('vertical')
url = json_report.get('url')
score = json_report.get('final_score')
findings = json_report.get('findings')

# screenshot_artifact_file = tool_context.state.get(f'screenshot_{auditor_key}', '')
# screenshot_artifact_file = f"screenshot_{task_id}.png"
# img_artifact = await tool_context.load_artifact(filename=screenshot_artifact_file)
# data = img_artifact.inline_data.data
if screenshot is not None: _write_image(screenshot, '/tmp/screenshot.png')
if eyeshot is not None: _write_image(eyeshot, '/tmp/eyeshot.png')
if clarity is not None: _write_image(clarity, '/tmp/clarity.png')
# image_name = os.path.basename(f'/tmp/{screenshot}')    
# mimetype, _ = mimetypes.guess_type(f'/tmp/{screenshot}')

creds = get_creds()
drive_service = build("drive", "v3", credentials=creds)
slides_service = build("slides", "v1", credentials=creds)


client_folder_id = copied_file.get('client_folder_id')
presentation_id = copied_file.get('id')
# %%
presentation = slides_service.presentations().get(presentationId=presentation_id).execute()
slides = presentation.get("slides")
# ------------------------------------

# update the recommendations slide    
slide = [slide for slide in slides if slide['objectId']==f'slide_{task_id}'][0]

requests = [
    {
        "replaceAllText": {
            "containsText": {
                "text": 'BrandName',
                "matchCase": True
            },
            "replaceText": client,
            'pageObjectIds': [f'slide_{task_id}']
        }        
    },
    {
        "replaceAllText": {
            "containsText": {
                "text": 'page_url',
                "matchCase": True
            },
            "replaceText": url,
            'pageObjectIds': [f'slide_{task_id}']
        }        
    },
    {
        "replaceAllText": {
            "containsText": {
                "text": 'PageType',
                "matchCase": True
            },
            "replaceText": page_type,
            'pageObjectIds': [f'slide_{task_id}']
        }        
    },
    {
        "replaceAllText": {
            "containsText": {
                "text": 'XX%',
                "matchCase": True
            },
            "replaceText": f"{score}%",
            'pageObjectIds': [f'slide_{task_id}']
        }        
    },
]
slides_service.presentations().batchUpdate(
    presentationId=presentation_id, body={"requests": requests}
).execute()
# ------------------------------------
# %%
for element in slide['pageElements']:
    if 'description' in element and element['description'] == '{{new_image}}':        
        print('found')
        break
# %%
element
# %%
# insert recommendations with styling
for element in slide['pageElements']:
    if 'description' in element and element['description'] == '{{recommendations}}':        
        break

shape_object_id = element["objectId"]
requests = []
for reco in findings:
    # 1. Define the text segments
    string_bold = reco['problem_discovered']
    string_regular = f" - {reco['description_of_problem']}"
    full_text = string_bold + string_regular

    # 2. Calculate the start and end indices for styling
    start_idx = 28
    bold_start_index = start_idx
    bold_end_index = bold_start_index + len(string_bold)
    regular_start_index = bold_end_index
    regular_end_index = start_idx + len(full_text)

    # 3. Define the styles based on the JSON you provided
    # Common style for both runs
    common_style = {
        "foregroundColor": {"opaqueColor": {"themeColor": "LIGHT1"}},
        "fontFamily": "DM Sans",
        "fontSize": {"magnitude": 11, "unit": "PT"},
    }

    # Style for the bold part
    style_bold = {
        **common_style,
        "bold": True,
    }

    # Style for the regular part
    style_regular = {
        **common_style,
        "bold": False,
    }

    # 4. Define the fields (properties) we want to update.
    style_fields = "bold,foregroundColor,fontFamily,fontSize"

    # 5. Build the batchUpdate request list
    requests += [
        {
            "insertText": {
                "objectId": shape_object_id,
                "insertionIndex": start_idx,
                "text": full_text + '\n',
            }
        },
        {
            # Second, apply the bold style to the first part of the text
            "updateTextStyle": {
                "objectId": shape_object_id,
                "textRange": {
                    "type": "FIXED_RANGE",
                    "startIndex": bold_start_index,
                    "endIndex": bold_end_index,
                },
                "style": style_bold,
                "fields": style_fields,
            }
        },
        {
            # Third, apply the regular style to the second part of the text
            "updateTextStyle": {
                "objectId": shape_object_id,
                "textRange": {
                    "type": "FIXED_RANGE",
                    "startIndex": regular_start_index,
                    "endIndex": regular_end_index,
                },
                "style": style_regular,
                "fields": style_fields,
            }
        },
    ]

if requests:
    slides_service.presentations().batchUpdate(
        presentationId=presentation_id, body={"requests": requests}
    ).execute()
# ------------------------------------    
# %%
# create image folder if not exists
query = f"mimeType='application/vnd.google-apps.folder' and trashed = false and '{client_folder_id}' in parents and name='Images'"
response = drive_service.files().list(
        q=query,
        fields="files(id)",
        corpora="allDrives", 
        includeItemsFromAllDrives=True,
        supportsAllDrives=True
    ).execute()
files = response.get('files', [])
if files: img_folder_id = files[0]['id']
else:
    folder_metadata = {
        'name': 'Images',
        'mimeType': 'application/vnd.google-apps.folder',
        'parents': [client_folder_id]
    }

    # Create the folder
    img_folder = drive_service.files().create(
        body=folder_metadata,
        fields='id, name',
        supportsAllDrives=True
    ).execute()
    img_folder_id = img_folder.get('id')
# ------------------------------------

# upload screenshot image to drive    
logger.info(f"Copying screenshot image to drive for task {task_id}")
if screenshot is not None: img_file = copy_to_drive(img_folder_id, 'screenshot.png', drive_service)
if eyeshot is not None: eyeshot_file = copy_to_drive(img_folder_id, 'eyeshot.png', drive_service)
if clarity is not None: clarity_file = copy_to_drive(img_folder_id, 'clarity.png', drive_service)
# %%
# insert images into slide
logger.info(f"Inserting images into slide for task {task_id}")
if screenshot is not None: insert_images_into_slide(presentation_id, img_file, task_id, 'screenshot', slides_service)
if eyeshot is not None: insert_images_into_slide(presentation_id, eyeshot_file, task_id, 'eyeshot', slides_service)
if clarity is not None: insert_images_into_slide(presentation_id, clarity_file, task_id, 'clarity', slides_service)
# ------------------------------------    

# %%
from typing import Any, Optional
import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_creds():
    """
    Get service account credentials from Secret Manager.
    Returns:
        google.oauth2.service_account.Credentials: The service account credentials.
    """

    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    secret_name = os.getenv("SERVICE_SECRET", "").strip()
    if not project_id:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is required to load Slides API credentials.")
    if not secret_name:
        raise RuntimeError("SERVICE_SECRET is required to load Slides API credentials.")

    client = SecretManagerServiceClient()
    name = f"projects/{project_id}/secrets/{secret_name}/versions/latest"
    response = client.access_secret_version(name=name)
    creds_json = json.loads(response.payload.data.decode('UTF-8'))

    scopes = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/presentations',
        'https://www.googleapis.com/auth/drive'
    ]
    creds = Credentials.from_service_account_info(creds_json, scopes=scopes)
    
    return creds

def _firestore_client() -> Optional[Any]:
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    database_id = os.getenv("FIRESTORE_DATABASE_ID", "").strip()
    if not project_id:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is required for Firestore access.")
    if database_id:
        return firestore.Client(project=project_id, database=database_id)
    return firestore.Client(project=project_id)

def _get_doc_from_firestore(collection: str, doc_id: str) -> dict:
    client = _firestore_client()
    if client is None:
        return
    doc = client.collection(collection).document(doc_id).get()
    return doc.to_dict()

def _get_json_report_from_firestore(task_id: str) -> dict:
    client = _firestore_client()
    if client is None:
        return
    doc = client.collection("reports").document(task_id).get()
    return doc.to_dict()

def copy_audit_slide(task_ids: list[str]) -> dict:
    """
    Copy the tempalte to create a Google Slides presentation for the audit report.
    Args:
        auditor_keys (list[str]): The list of auditor keys.
        tool_context (ToolContext): The context for the tool execution.
    Returns:
        str: The URL of the created Google Slides presentation.
    """
    creds = get_creds()
    target_folder_id = TARGET_FOLDER_KEY
    template_file_id = TEMPLATE_FILE_KEY

    drive_service = build("drive", "v3", credentials=creds)
    slides_service = build("slides", "v1", credentials=creds)
    
    doc = _get_json_report_from_firestore(task_ids[0])
    client = doc.get('clientName')
    vertical = doc.get('vertical')

    # check if the client folder exists
    
    query = f"mimeType='application/vnd.google-apps.folder' and trashed = false and '{target_folder_id}' in parents and name='{client}'"
    response = drive_service.files().list(
            q=query,
            fields="files(id)",
            corpora="allDrives", 
            includeItemsFromAllDrives=True,
            supportsAllDrives=True
        ).execute() 
    
    files = response.get('files', [])
    if files: client_folder_id = files[0]['id']
    else:
        # Create a new folder for the client        
        folder_metadata = {
            'name': client,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [target_folder_id]
        }    

        # Create the folder
        client_folder = drive_service.files().create(
            body=folder_metadata,
            fields='id, name',
            supportsAllDrives=True
        ).execute()
        client_folder_id = client_folder.get('id')
    # ------------------------------------
    

    # copy the template to the client folder
    today_str = datetime.today().strftime('%d-%B-%Y').lower()
    copy_metadata = {
        'name': f'{client} Audit - {vertical} - {today_str}',
        'parents': [client_folder_id]
    }

    # Copy the file
    copied_file = drive_service.files().copy(
        fileId=template_file_id,
        body=copy_metadata,
        fields='id, name',
        supportsAllDrives=True
    ).execute()

    # copy the second slide for each auditor key
    presentation_id = copied_file.get('id')
    presentation = slides_service.presentations().get(presentationId=presentation_id).execute()
    slides = presentation.get("slides")
    # original_slide_id = slides[1]['objectId']
    original_slide_id = 'g3ee49a36b53_0_0'
    duplicate_ids = [f'slide_{key}' for key in task_ids]
    requests = [
        {
            'duplicateObject': {
                'objectId': original_slide_id,
                'objectIds': {
                    original_slide_id: duplicate_id,
                }
            }
        }
        for duplicate_id in duplicate_ids
    ]

    response = slides_service.presentations().batchUpdate(
                presentationId=presentation_id, body={"requests": requests}).execute()

    # delete the original slide    
    requests = [
        {
            "deleteObject": {
                "objectId": original_slide_id
            }
        }
    ]
    response = slides_service.presentations().batchUpdate(
                presentationId=presentation_id, body={"requests": requests}).execute()

    copied_file['client_folder_id'] = client_folder_id
    return copied_file


def create_slide_for_key(task_id: str, copied_file: dict) -> str:
    """
    Callback function to create a Google Slides presentation from the final report.
    Args:
        screenshot_artifact_file (str): The screenshot artifact file name.
        tool_context (ToolContext): The context for the tool execution.
    Returns:
        str: The URL of the created Google Slides presentation.
    """    

    
    json_report = _get_json_report_from_firestore(task_id)
    audit_doc = _get_doc_from_firestore("audits", task_id)
    eyequant_doc = _get_doc_from_firestore("eyequant", task_id)
    screenshot = audit_doc.get('screenshot')
    eyeshot = eyequant_doc.get('eyeshot')
    clarity = eyequant_doc.get('clarity')

    def _download_gcs(gs_path: str, local_path: str) -> None:
        without_scheme = gs_path[len("gs://"):]
        bucket_name, blob_path = without_scheme.split("/", 1)
        storage.Client().bucket(bucket_name).blob(blob_path).download_to_filename(local_path)

    def _write_image(value: str, local_path: str) -> None:
        if value.startswith("gs://"):
            _download_gcs(value, local_path)
        else:
            open(local_path, 'wb').write(base64.b64decode(value))
    client = json_report.get('clientName')
    page_type = json_report.get('page_type')
    vertical = json_report.get('vertical')
    url = json_report.get('url')
    score = json_report.get('final_score')
    findings = json_report.get('findings')

    # screenshot_artifact_file = tool_context.state.get(f'screenshot_{auditor_key}', '')
    # screenshot_artifact_file = f"screenshot_{task_id}.png"
    # img_artifact = await tool_context.load_artifact(filename=screenshot_artifact_file)
    # data = img_artifact.inline_data.data
    if screenshot is not None: _write_image(screenshot, '/tmp/screenshot.png')
    if eyeshot is not None: _write_image(eyeshot, '/tmp/eyeshot.png')
    if clarity is not None: _write_image(clarity, '/tmp/clarity.png')
    # image_name = os.path.basename(f'/tmp/{screenshot}')    
    # mimetype, _ = mimetypes.guess_type(f'/tmp/{screenshot}')

    creds = get_creds()
    drive_service = build("drive", "v3", credentials=creds)
    slides_service = build("slides", "v1", credentials=creds)


    client_folder_id = copied_file.get('client_folder_id')
    presentation_id = copied_file.get('id')
    # %%
    presentation = slides_service.presentations().get(presentationId=presentation_id).execute()
    slides = presentation.get("slides")
    # ------------------------------------

    # update the recommendations slide    
    slide = [slide for slide in slides if slide['objectId']==f'slide_{task_id}'][0]

    requests = [
        {
            "replaceAllText": {
                "containsText": {
                    "text": 'BrandName',
                    "matchCase": True
                },
                "replaceText": client,
                'pageObjectIds': [f'slide_{task_id}']
            }        
        },
        {
            "replaceAllText": {
                "containsText": {
                    "text": 'page_url',
                    "matchCase": True
                },
                "replaceText": url,
                'pageObjectIds': [f'slide_{task_id}']
            }        
        },
        {
            "replaceAllText": {
                "containsText": {
                    "text": 'PageType',
                    "matchCase": True
                },
                "replaceText": page_type,
                'pageObjectIds': [f'slide_{task_id}']
            }        
        },
        {
            "replaceAllText": {
                "containsText": {
                    "text": 'XX%',
                    "matchCase": True
                },
                "replaceText": f"{score}%",
                'pageObjectIds': [f'slide_{task_id}']
            }        
        },
    ]
    slides_service.presentations().batchUpdate(
        presentationId=presentation_id, body={"requests": requests}
    ).execute()
    # ------------------------------------
    # insert recommendations with styling
    for element in slide['pageElements']:
        if 'description' in element and element['description'] == '{{recommendations}}':        
            break

    shape_object_id = element["objectId"]
    requests = []
    for reco in findings:
        # 1. Define the text segments
        string_bold = reco['problem_discovered']
        string_regular = f" - {reco['description_of_problem']}"
        full_text = string_bold + string_regular

        # 2. Calculate the start and end indices for styling
        start_idx = 28
        bold_start_index = start_idx
        bold_end_index = bold_start_index + len(string_bold)
        regular_start_index = bold_end_index
        regular_end_index = start_idx + len(full_text)

        # 3. Define the styles based on the JSON you provided
        # Common style for both runs
        common_style = {
            "foregroundColor": {"opaqueColor": {"themeColor": "LIGHT1"}},
            "fontFamily": "DM Sans",
            "fontSize": {"magnitude": 11, "unit": "PT"},
        }

        # Style for the bold part
        style_bold = {
            **common_style,
            "bold": True,
        }

        # Style for the regular part
        style_regular = {
            **common_style,
            "bold": False,
        }

        # 4. Define the fields (properties) we want to update.
        style_fields = "bold,foregroundColor,fontFamily,fontSize"

        # 5. Build the batchUpdate request list
        requests += [
            {
                "insertText": {
                    "objectId": shape_object_id,
                    "insertionIndex": start_idx,
                    "text": full_text + '\n',
                }
            },
            {
                # Second, apply the bold style to the first part of the text
                "updateTextStyle": {
                    "objectId": shape_object_id,
                    "textRange": {
                        "type": "FIXED_RANGE",
                        "startIndex": bold_start_index,
                        "endIndex": bold_end_index,
                    },
                    "style": style_bold,
                    "fields": style_fields,
                }
            },
            {
                # Third, apply the regular style to the second part of the text
                "updateTextStyle": {
                    "objectId": shape_object_id,
                    "textRange": {
                        "type": "FIXED_RANGE",
                        "startIndex": regular_start_index,
                        "endIndex": regular_end_index,
                    },
                    "style": style_regular,
                    "fields": style_fields,
                }
            },
        ]

    if requests:
        slides_service.presentations().batchUpdate(
            presentationId=presentation_id, body={"requests": requests}
        ).execute()
    # ------------------------------------    
    
    # create image folder if not exists
    query = f"mimeType='application/vnd.google-apps.folder' and trashed = false and '{client_folder_id}' in parents and name='Images'"
    response = drive_service.files().list(
            q=query,
            fields="files(id)",
            corpora="allDrives", 
            includeItemsFromAllDrives=True,
            supportsAllDrives=True
        ).execute()
    files = response.get('files', [])
    if files: img_folder_id = files[0]['id']
    else:
        folder_metadata = {
            'name': 'Images',
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [client_folder_id]
        }

        # Create the folder
        img_folder = drive_service.files().create(
            body=folder_metadata,
            fields='id, name',
            supportsAllDrives=True
        ).execute()
        img_folder_id = img_folder.get('id')
    # ------------------------------------

    # upload screenshot image to drive    
    logger.info(f"Copying screenshot image to drive for task {task_id}")
    if screenshot is not None: img_file = copy_to_drive(img_folder_id, 'screenshot.png', drive_service)
    if eyeshot is not None: eyeshot_file = copy_to_drive(img_folder_id, 'eyeshot.png', drive_service)
    if clarity is not None: clarity_file = copy_to_drive(img_folder_id, 'clarity.png', drive_service)
    
    # insert images into slide
    logger.info(f"Inserting images into slide for task {task_id}")
    if screenshot is not None: insert_images_into_slide(presentation_id, img_file, task_id, 'screenshot', slides_service)
    if eyeshot is not None: insert_images_into_slide(presentation_id, eyeshot_file, task_id, 'eyeshot', slides_service)
    if clarity is not None: insert_images_into_slide(presentation_id, clarity_file, task_id, 'clarity', slides_service)
    # ------------------------------------    
        
    return "success"

def copy_to_drive(img_folder_id: str, file_name: str, drive_service: Any) -> Any:
    """
    Copy the file to drive.
    """
    # upload screenshot image to drive    
    today_str = datetime.today().strftime('%d-%B-%Y').lower()
    target_file_name = f"page_{today_str}_{file_name}"
    file_metadata = {'name': target_file_name, 'parents': [img_folder_id]}
    media = MediaFileUpload(f'/tmp/{file_name}', mimetype='image/png')

    # Upload the file
    print(f"Uploading {target_file_name} to Google Drive...")
    img_file = drive_service.files().create(
        body=file_metadata,
        media_body=media,
        fields='id, webContentLink',
        supportsAllDrives=True
    ).execute()

    file_id = img_file.get('id')

    # --- Make the file public (so Slides API can access it) ---
    permission_body = {'role': 'reader', 'type': 'anyone',}
    drive_service.permissions().create(
        fileId=file_id,
        body=permission_body,
        supportsAllDrives=True
    ).execute()

    return img_file

def insert_images_into_slide(presentation_id: str, img_file: Any, task_id: str, file_name: str, slides_service: Any) -> None:
    """
    Insert the images into the slide.
    """
    # insert image into slide
    page_id = f'slide_{task_id}'
    object_id = f"MyImage_{task_id}_{file_name}"
    image_url = img_file.get('webContentLink')
    requests = [
        {
            "createImage": {
                "objectId": object_id,
                "url": image_url,
                "elementProperties": {
                    "pageObjectId": page_id,
                    "size": {'width': {'magnitude': 11000, 'unit': 'EMU'},
                        'height': {'magnitude': 23900, 'unit': 'EMU'}},
                    "transform": {'scaleX': 216.251,
                        'scaleY': 216.251,
                        'translateX': 6494469.255,
                        'translateY': 585100,
                        'unit': 'EMU'},
                },
            }
        },    
    ]
    slides_service.presentations().batchUpdate(
        presentationId=presentation_id, body={"requests": requests}
    ).execute()

def update_roi_slide(presentation_id: str, task_id: str) -> None:
    """
    Update the ROI slide with calculated values.
    """      

    json_report = _get_json_report_from_firestore(task_id)
    roi_calc = json_report['media_metrics']

    creds = get_creds()
    slides_service = build("slides", "v1", credentials=creds)

    ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref.zip'
    c = CurrencyConverter(ECB_URL)
    media_transactions = roi_calc.get('media_transactions', 0)
    media_traffic = roi_calc.get('media_traffic', 0)
    revenue_per_sale = roi_calc.get('revenue_per_sale', 0)
    currency = roi_calc.get('currency', 'USD')
    media_spend = roi_calc.get('media_spend', 0)

    media_revenue = media_transactions * revenue_per_sale
    current_cvr = media_transactions / media_traffic 
    cvr_lift = 0.02 * 7
    projected_cvr = current_cvr * (1 + cvr_lift)
    revenue_opp = projected_cvr * media_traffic * revenue_per_sale - media_revenue    
    try:
        cost_per_month = c.convert(12.5e3, 'USD', currency)
    except Exception as e:
        cost_per_month = 12.5e3
    roi = (revenue_opp - cost_per_month * 12)
    annual_cost = cost_per_month * 12

    cvr_lift = round(cvr_lift*100, 2)
    media_spend = format_currency(media_spend, currency, u'¤¤ #,##0', locale='en_US')
    media_spend = '.'.join(media_spend.split('.')[:-1])
    media_revenue = format_currency(media_revenue, currency, u'¤¤ #,##0', locale='en_US')
    media_revenue = '.'.join(media_revenue.split('.')[:-1])

    current_cvr = f"{current_cvr*100:.2f}%"
    projected_cvr = f"{projected_cvr*100:.2f}%"
    revenue_opp = format_currency(revenue_opp, currency, u'¤¤ #,##0', locale='en_US')
    revenue_opp = '.'.join(revenue_opp.split('.')[:-1])
    annual_cost = format_currency(annual_cost, currency, u'¤¤ #,##0', locale='en_US')
    annual_cost = '.'.join(annual_cost.split('.')[:-1])
    roi = format_currency(roi, currency, u'¤¤ #,##0', locale='en_US')
    roi = '.'.join(roi.split('.')[:-1])

    # cvr_lift = round(roi_calc.get('cvr_lift', 0))
    # media_spend = format_currency(roi_calc.get('media_spend', 0), roi_calc.get('currency', 'USD'), u'¤¤ #,##0', locale='en_US')
    # media_spend = '.'.join(media_spend.split('.')[:-1])
    # media_revenue = roi_calc.get('media_transactions', 0) * roi_calc.get('revenue_per_sale', 0)
    # # media_revenue = format_currency(roi_calc.get('media_revenue', 0), roi_calc.get('currency', 'USD'), u'¤¤ #,##0', locale='en_US')
    # media_revenue = format_currency(media_revenue, roi_calc.get('currency', 'USD'), u'¤¤ #,##0', locale='en_US')
    # media_revenue = '.'.join(media_revenue.split('.')[:-1])

    # current_cvr = f"{roi_calc.get('current_cvr', 0):.2f}%"
    # projected_cvr = f"{roi_calc.get('projected_cvr', 0):.2f}%"
    # revenue_opp = format_currency(roi_calc.get('revenue_opp', 0), roi_calc.get('currency', 'USD'), u'¤¤ #,##0', locale='en_US')
    # revenue_opp = '.'.join(revenue_opp.split('.')[:-1])
    # annual_cost = format_currency(roi_calc.get('annual_cost', 0), roi_calc.get('currency', 'USD'), u'¤¤ #,##0', locale='en_US')
    # annual_cost = '.'.join(annual_cost.split('.')[:-1])
    # roi = format_currency(roi_calc.get('roi', 0), roi_calc.get('currency', 'USD'), u'¤¤ #,##0', locale='en_US')
    # roi = '.'.join(roi.split('.')[:-1])

    requests = [
        {
            "replaceAllText": {
                "containsText": {
                    "text": '{{CVRLift}}',
                    "matchCase": True
                },
                "replaceText": f"{cvr_lift}%"
            }        
        },
        {
            "replaceAllText": {
                "containsText": {
                    "text": '{{MediaSpend}}',
                    "matchCase": True
                },
                "replaceText": f"{media_spend}"
            }        
        },
        {
            "replaceAllText": {
                "containsText": {
                    "text": '{{MediaRev}}',
                    "matchCase": True
                },
                "replaceText": f"{media_revenue}"
            }        
        },
        {
            "replaceAllText": {
                "containsText": {
                    "text": '{{CurrentCVR}}',
                    "matchCase": True
                },
                "replaceText": f"{current_cvr}"
            }        
        },
        {
            "replaceAllText": {
                "containsText": {
                    "text": '{{ProjectedCVR}}',
                    "matchCase": True
                },
                "replaceText": f"{projected_cvr}"
            }        
        },
        {
            "replaceAllText": {
                "containsText": {
                    "text": '{{RevenueOpp}}',
                    "matchCase": True
                },
                "replaceText": f"{revenue_opp}"
            }        
        },
        {
            "replaceAllText": {
                "containsText": {
                    "text": '{{CostPerMonthInCurrency}}',
                    "matchCase": True
                },
                "replaceText": f"{annual_cost}"
            }        
        },
        {
            "replaceAllText": {
                "containsText": {
                    "text": '{{ROI}}',
                    "matchCase": True
                },
                "replaceText": f"{roi}"
            }        
        },

    ]

    slides_service.presentations().batchUpdate(
        presentationId=presentation_id, body={"requests": requests}
    ).execute()
    return "success"
# %%
