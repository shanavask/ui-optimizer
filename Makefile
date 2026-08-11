GIT_BRANCH := $(shell git rev-parse --abbrev-ref HEAD 2>/dev/null)

ifeq ($(GIT_BRANCH),main)
ENV_FILE := .env
DEPLOY_SUFFIX :=
else
ENV_FILE := .env.dev
DEPLOY_SUFFIX := -dev
endif

include $(ENV_FILE)
.EXPORT_ALL_VARIABLES:

.PHONY: dev computer-api slides-api frontend

# 	$(MAKE) slides-api & \
# SLIDES_API=http://localhost:5402 CRITERIA_AGENT=http://localhost:8001
# AUDITOR_AGENT=http://localhost:8003 
dev:
	@trap 'trap - INT TERM; kill 0; exit 130' INT TERM; \
	ID_TOKEN="$$(gcloud auth print-identity-token)"; \
	export ID_TOKEN; \
	$(MAKE) computer-api & \
 	$(MAKE) slides-api & \
	$(MAKE) COMPUTER_API=http://localhost:5401 SLIDES_API=http://localhost:5402 frontend  & \
	wait

computer-api:
	USE_VERTEXAI=$(GOOGLE_GENAI_USE_VERTEXAI) VERTEXAI_PROJECT=$(GOOGLE_CLOUD_PROJECT) VERTEXAI_LOCATION=global uv run apis/computer-use/run.py --mode server --port 5401

slides-api:
	uv run apis/slidesapi/main.py --mode server --port 5402

auditor-agent:
	uv run adk api_server agents/ui-auditor --host 0.0.0.0 --port 8003 --reload

frontend:
	ID_TOKEN="$$(gcloud auth print-identity-token)"; \
	export ID_TOKEN; \
	npm run dev --prefix frontend

deploy-audit:
	cd agents/ui-auditor && \
	agents-cli deploy \
		--project $(GOOGLE_CLOUD_PROJECT) \
		--region $(GOOGLE_CLOUD_LOCATION) \
		--service-name ui-auditor$(DEPLOY_SUFFIX) \
		--update-env-vars \
		    "GOOGLE_CLOUD_REGION=$(GOOGLE_CLOUD_LOCATION),LLM_MODEL=$(LLM_MODEL),GOOGLE_GENAI_USE_VERTEXAI=$(GOOGLE_GENAI_USE_VERTEXAI),SIMILARWEB_API_KEY=$(SIMILARWEB_API_KEY),FIRESTORE_DATABASE_ID=$(FIRESTORE_DATABASE_ID)"


deploy-computer:
	gcloud beta run deploy computer-use$(DEPLOY_SUFFIX) \
		--source ./apis/computer-use \
		--project $(GOOGLE_CLOUD_PROJECT) \
		--region $(GOOGLE_CLOUD_LOCATION) \
		--memory "4Gi" \
		--cpu "1" \
		--timeout 3600 \
		--platform managed \
		--no-cpu-throttling \
		--no-allow-unauthenticated \
		--set-build-env-vars "GOOGLE_PYTHON_VERSION=3.13.11" \
		--set-env-vars "FIRESTORE_DATABASE_ID=$(FIRESTORE_DATABASE_ID),USE_VERTEXAI=$(GOOGLE_GENAI_USE_VERTEXAI),VERTEXAI_PROJECT=$(GOOGLE_CLOUD_PROJECT),VERTEXAI_LOCATION=global,STORAGE_BUCKET=$(STORAGE_BUCKET),BROWSERBASE_API_KEY=$(BROWSERBASE_API_KEY),BROWSERBASE_PROJECT_ID=$(BROWSERBASE_PROJECT_ID)"

deploy-slidesapi:
	gcloud beta run deploy ui-audit-slides$(DEPLOY_SUFFIX) \
		--source ./apis/slidesapi \
		--project $(GOOGLE_CLOUD_PROJECT) \
		--region $(GOOGLE_CLOUD_LOCATION) \
		--no-allow-unauthenticated \
		--set-build-env-vars "GOOGLE_PYTHON_VERSION=3.13.11" \
		--set-env-vars "GOOGLE_CLOUD_PROJECT=$(GOOGLE_CLOUD_PROJECT),STORAGE_BUCKET=$(STORAGE_BUCKET),FIRESTORE_DATABASE_ID=$(FIRESTORE_DATABASE_ID),LLM_MODEL=$(LLM_MODEL),SERVICE_SECRET=$(SERVICE_SECRET),TARGET_FOLDER_KEY=$(TARGET_FOLDER_KEY),TEMPLATE_FILE_KEY=$(TEMPLATE_FILE_KEY),EYEQUANT_API_KEY=$(EYEQUANT_API_KEY)"

deploy-frontend:
	gcloud beta run deploy ui-audit$(DEPLOY_SUFFIX) --source ./frontend \
			--project $(GOOGLE_CLOUD_PROJECT) --region $(GOOGLE_CLOUD_LOCATION) \
			--platform managed --no-allow-unauthenticated \
			--timeout 3600 \
			--set-env-vars \
			"GOOGLE_CLOUD_PROJECT=$(GOOGLE_CLOUD_PROJECT),GOOGLE_CLOUD_LOCATION=$(GOOGLE_CLOUD_LOCATION),STORAGE_BUCKET=$(STORAGE_BUCKET),FIRESTORE_DATABASE_ID=$(FIRESTORE_DATABASE_ID),CRITERIA_AGENT=$(CRITERIA_AGENT),GUESSTIMATE_AGENT=$(GUESSTIMATE_AGENT),AUDITOR_AGENT=$(AUDITOR_AGENT),COMPUTER_API=$(COMPUTER_API),SLIDES_API=$(SLIDES_API)" \
