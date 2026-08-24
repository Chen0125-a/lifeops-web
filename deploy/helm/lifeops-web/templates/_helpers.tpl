{{- define "lifeops-web.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "lifeops-web.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else if contains (include "lifeops-web.name" .) .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "lifeops-web.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "lifeops-web.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "lifeops-web.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "lifeops-web.selectorLabels" -}}
app.kubernetes.io/name: {{ include "lifeops-web.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "lifeops-web.webImage" -}}
{{- if .Values.web.image.digest -}}
{{ printf "%s@%s" .Values.web.image.repository .Values.web.image.digest }}
{{- else -}}
{{ printf "%s:%s" .Values.web.image.repository .Values.web.image.tag }}
{{- end -}}
{{- end }}

{{- define "lifeops-web.apiImage" -}}
{{- if .Values.api.image.digest -}}
{{ printf "%s@%s" .Values.api.image.repository .Values.api.image.digest }}
{{- else -}}
{{ printf "%s:%s" .Values.api.image.repository .Values.api.image.tag }}
{{- end -}}
{{- end }}

{{- define "lifeops-web.mysqlHost" -}}
{{- if .Values.mysql.enabled -}}
{{ printf "%s-mysql" (include "lifeops-web.fullname" .) }}
{{- else -}}
{{ required "externalDatabase.host is required when mysql.enabled=false" .Values.externalDatabase.host }}
{{- end -}}
{{- end }}

{{- define "lifeops-web.mysqlSecret" -}}
{{- if or .Values.secrets.create .Values.externalSecret.enabled -}}
{{ .Values.secrets.name }}
{{- else if .Values.mysql.enabled -}}
{{ .Values.mysql.auth.existingSecret }}
{{- else -}}
{{ .Values.externalDatabase.existingSecret }}
{{- end -}}
{{- end }}

{{- define "lifeops-web.apiSecret" -}}
{{- if or .Values.secrets.create .Values.externalSecret.enabled -}}
{{ .Values.secrets.name }}
{{- else -}}
{{ .Values.api.existingSecret }}
{{- end -}}
{{- end }}

{{- define "lifeops-web.mysqlPasswordKey" -}}
{{- if .Values.mysql.enabled -}}
{{ .Values.mysql.auth.passwordKey }}
{{- else -}}
{{ .Values.externalDatabase.passwordKey }}
{{- end -}}
{{- end }}

{{- define "lifeops-web.mediaClaimName" -}}
{{- if .Values.media.filesystem.persistence.existingClaim -}}
{{ .Values.media.filesystem.persistence.existingClaim }}
{{- else -}}
{{ printf "%s-media" (include "lifeops-web.fullname" .) }}
{{- end -}}
{{- end }}

{{- define "lifeops-web.mediaSecret" -}}
{{- if .Values.externalSecret.enabled -}}
{{ .Values.secrets.name }}
{{- else -}}
{{ required "media.s3.existingSecret is required for S3 media storage" .Values.media.s3.existingSecret }}
{{- end -}}
{{- end }}
