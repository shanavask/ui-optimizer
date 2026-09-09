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

# Cloud Tasks queue backing the pipeline orchestrator, now hosted entirely in
# apis/slidesapi (apis/slidesapi/cloud_tasks_client.py) - not the frontend,
# since the frontend's IAP setting is incompatible with Cloud Tasks' OIDC
# push (see pipeline-infra below). PIPELINE_TICK_URL has no default - it's
# slidesapi's own public URL + /pipeline/tick, only known after its first
# deploy, so set it in .env/.env.dev like COMPUTER_API/SLIDES_API.
PIPELINE_TASKS_QUEUE ?= pipeline-audit$(DEPLOY_SUFFIX)
PIPELINE_TASKS_SA_EMAIL ?= pipeline-tasks-invoker$(DEPLOY_SUFFIX)@$(GOOGLE_CLOUD_PROJECT).iam.gserviceaccount.com

.PHONY: dev computer-api slides-api frontend pipeline-infra

# 	$(MAKE) slides-api & \
# SLIDES_API=http://localhost:5402 CRITERIA_AGENT=http://localhost:8001
# AUDITOR_AGENT=http://localhost:8003 
dev:
	@trap 'trap - INT TERM; kill 0; exit 130' INT TERM; \
	ID_TOKEN="$$(gcloud auth print-identity-token)"; \
	export ID_TOKEN; \
	$(MAKE) computer-api & \
 	$(MAKE) COMPUTER_API=http://localhost:5401 slides-api & \
	$(MAKE) SLIDES_API=http://localhost:5402 frontend  & \
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
		--timeout 3600 \
		--no-allow-unauthenticated \
		--set-build-env-vars "GOOGLE_PYTHON_VERSION=3.13.11" \
		--set-env-vars "GOOGLE_CLOUD_PROJECT=$(GOOGLE_CLOUD_PROJECT),GOOGLE_CLOUD_LOCATION=$(GOOGLE_CLOUD_LOCATION),STORAGE_BUCKET=$(STORAGE_BUCKET),FIRESTORE_DATABASE_ID=$(FIRESTORE_DATABASE_ID),LLM_MODEL=$(LLM_MODEL),SERVICE_SECRET=$(SERVICE_SECRET),TARGET_FOLDER_KEY=$(TARGET_FOLDER_KEY),TEMPLATE_FILE_KEY=$(TEMPLATE_FILE_KEY),EYEQUANT_API_KEY=$(EYEQUANT_API_KEY),AUDITOR_AGENT=$(AUDITOR_AGENT),COMPUTER_API=$(COMPUTER_API),PIPELINE_TASKS_QUEUE=$(PIPELINE_TASKS_QUEUE),PIPELINE_TICK_URL=$(PIPELINE_TICK_URL),PIPELINE_TASKS_SA_EMAIL=$(PIPELINE_TASKS_SA_EMAIL)"

# The frontend is now a thin UI + auth-adding proxy with no business logic of
# its own (see frontend/src/lib/backend-proxy.ts) - it only needs to know
# where slidesapi lives, not any of the agent/computer-use/Firestore/Cloud
# Tasks config that used to live here.
deploy-frontend:
	gcloud beta run deploy ui-audit$(DEPLOY_SUFFIX) --source ./frontend \
			--project $(GOOGLE_CLOUD_PROJECT) --region $(GOOGLE_CLOUD_LOCATION) \
			--platform managed --no-allow-unauthenticated \
			--timeout 3600 \
			--set-env-vars \
			"SLIDES_API=$(SLIDES_API),PIPELINE_TICK_URL=$(PIPELINE_TICK_URL)"

# One-time per environment, after slidesapi has been deployed at least once
# (needs its URL for PIPELINE_TICK_URL and its runtime SA for the enqueuer/
# actAs bindings). Safe to re-run in full: the queue-create and SA-create
# steps are prefixed with `-` so an "already exists" error from either one
# doesn't stop the add-iam-policy-binding steps below from (re-)applying -
# useful for topping up bindings that were missed on an earlier partial run.
#
# Targets ui-audit-slides (not ui-audit/the frontend): slidesapi has no IAP,
# only plain Cloud Run IAM, so Cloud Tasks' OIDC push reaches it reliably -
# unlike the frontend, where IAP + IAM together broke Cloud Tasks' server-to-
# server auth (see git history / PR description for the full story).
pipeline-infra:
	-gcloud tasks queues create $(PIPELINE_TASKS_QUEUE) \
		--project $(GOOGLE_CLOUD_PROJECT) \
		--location $(GOOGLE_CLOUD_LOCATION) \
		--max-attempts=3 \
		--min-backoff=5s \
		--max-backoff=30s
	-gcloud iam service-accounts create pipeline-tasks-invoker$(DEPLOY_SUFFIX) \
		--project $(GOOGLE_CLOUD_PROJECT) \
		--display-name "Cloud Tasks invoker for the ui-audit pipeline orchestrator"
	gcloud run services add-iam-policy-binding ui-audit-slides$(DEPLOY_SUFFIX) \
		--project $(GOOGLE_CLOUD_PROJECT) \
		--region $(GOOGLE_CLOUD_LOCATION) \
		--member "serviceAccount:$(PIPELINE_TASKS_SA_EMAIL)" \
		--role roles/run.invoker
	@SLIDESAPI_SA="$$(gcloud run services describe ui-audit-slides$(DEPLOY_SUFFIX) --project $(GOOGLE_CLOUD_PROJECT) --region $(GOOGLE_CLOUD_LOCATION) --format='value(spec.template.spec.serviceAccountName)')"; \
	echo "Granting roles/cloudtasks.enqueuer on $(PIPELINE_TASKS_QUEUE) to slidesapi runtime SA: $$SLIDESAPI_SA"; \
	gcloud tasks queues add-iam-policy-binding $(PIPELINE_TASKS_QUEUE) \
		--project $(GOOGLE_CLOUD_PROJECT) \
		--location $(GOOGLE_CLOUD_LOCATION) \
		--member "serviceAccount:$$SLIDESAPI_SA" \
		--role roles/cloudtasks.enqueuer; \
	echo "Granting roles/iam.serviceAccountUser on $(PIPELINE_TASKS_SA_EMAIL) to slidesapi runtime SA: $$SLIDESAPI_SA"; \
	gcloud iam service-accounts add-iam-policy-binding $(PIPELINE_TASKS_SA_EMAIL) \
		--project $(GOOGLE_CLOUD_PROJECT) \
		--member "serviceAccount:$$SLIDESAPI_SA" \
		--role roles/iam.serviceAccountUser
