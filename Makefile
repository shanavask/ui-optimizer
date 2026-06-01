include .env
.EXPORT_ALL_VARIABLES:

.PHONY: dev computer criteria-agent frontend

# $(MAKE) computer-api & \
# $(MAKE) guestimate-agent & \
# 	$(MAKE) slides-api & \

dev:
	@trap 'trap - INT TERM; kill 0; exit 130' INT TERM; \
	ID_TOKEN="$$(gcloud auth print-identity-token)"; \
	export ID_TOKEN; \
	$(MAKE) slides-api & \
	$(MAKE) frontend SLIDES_API=http://localhost:5402 & \
	wait

computer-api:
	uv run apis/computer-use/main.py --mode server --port 5401

slides-api:
	uv run apis/slidesapi/main.py --mode server --port 5402

criteria-agent:
	uv run adk api_server agents/ui-audit-criteria --host 0.0.0.0 --port 8001 --reload

guestimate-agent:
	uv run adk api_server agents/ui-audit-guestimate --host 0.0.0.0 --port 8002 --reload

frontend:
	npm run dev --prefix frontend

deploy-criteria:
	cd agents/ui-audit-criteria && \
	agents-cli deploy \
		--project $(GOOGLE_CLOUD_PROJECT) \
		--region $(GOOGLE_CLOUD_LOCATION) \
		--update-env-vars \
		    "GOOGLE_CLOUD_REGION=$(GOOGLE_CLOUD_LOCATION), LLM_MODEL=$(LLM_MODEL), GOOGLE_GENAI_USE_VERTEXAI=$(GOOGLE_GENAI_USE_VERTEXAI)"

deploy-guestimate:
	cd agents/ui-audit-guestimate && \
	agents-cli deploy \
		--project $(GOOGLE_CLOUD_PROJECT) \
		--region $(GOOGLE_CLOUD_LOCATION) \
		--update-env-vars \
		    "GOOGLE_CLOUD_REGION=$(GOOGLE_CLOUD_LOCATION), LLM_MODEL=$(LLM_MODEL), GOOGLE_GENAI_USE_VERTEXAI=$(GOOGLE_GENAI_USE_VERTEXAI), SIMILARWEB_API_KEY=$(SIMILARWEB_API_KEY)"


deploy-computer:
	gcloud beta run deploy computer-use \
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
		--set-env-vars "FIRESTORE_DATABASE_ID=$(FIRESTORE_DATABASE_ID),GOOGLE_GENAI_USE_VERTEXAI=$(GOOGLE_GENAI_USE_VERTEXAI),GOOGLE_CLOUD_PROJECT=$(GOOGLE_CLOUD_PROJECT),BROWSERBASE_API_KEY=$(BROWSERBASE_API_KEY),BROWSERBASE_PROJECT_ID=$(BROWSERBASE_PROJECT_ID)"

deploy-slidesapi:
	gcloud beta run deploy ui-audit-slides \
		--source ./apis/slidesapi \
		--project $(GOOGLE_CLOUD_PROJECT) \
		--region $(GOOGLE_CLOUD_LOCATION) \
		--no-allow-unauthenticated \
		--set-build-env-vars "GOOGLE_PYTHON_VERSION=3.13.11" \
		--set-env-vars "GOOGLE_CLOUD_PROJECT=$(GOOGLE_CLOUD_PROJECT),FIRESTORE_DATABASE_ID=$(FIRESTORE_DATABASE_ID),LLM_MODEL=$(LLM_MODEL),SERVICE_SECRET=$(SERVICE_SECRET),TARGET_FOLDER_KEY=$(TARGET_FOLDER_KEY),TEMPLATE_FILE_KEY=$(TEMPLATE_FILE_KEY),EYEQUANT_API_KEY=$(EYEQUANT_API_KEY)"

deploy-frontend:
	gcloud beta run deploy ui-audit --source ./frontend \
			--project $(GOOGLE_CLOUD_PROJECT) --region $(GOOGLE_CLOUD_LOCATION) \
			--platform managed --no-allow-unauthenticated \
			--timeout 3600 \
			--set-env-vars \
			"GOOGLE_CLOUD_PROJECT=$(GOOGLE_CLOUD_PROJECT),GOOGLE_CLOUD_LOCATION=$(GOOGLE_CLOUD_LOCATION),FIRESTORE_DATABASE_ID=$(FIRESTORE_DATABASE_ID),CRITERIA_AGENT=$(CRITERIA_AGENT),GUESSTIMATE_AGENT=$(GUESSTIMATE_AGENT),COMPUTER_API=$(COMPUTER_API),SLIDES_API=$(SLIDES_API)" \
