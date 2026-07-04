{{- define "pagedrop-host.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "pagedrop-host.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "pagedrop-host.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "pagedrop-host.labels" -}}
app.kubernetes.io/name: {{ include "pagedrop-host.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "pagedrop-host.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pagedrop-host.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "pagedrop-host.secretName" -}}
{{- if .Values.token.existingSecret -}}{{ .Values.token.existingSecret }}{{- else -}}{{ include "pagedrop-host.fullname" . }}{{- end -}}
{{- end -}}

{{- define "pagedrop-host.secretKey" -}}
{{- default "token" .Values.token.existingSecretKey -}}
{{- end -}}

{{- define "pagedrop-host.cookieSecretName" -}}
{{- if .Values.protection.cookieSecret.existingSecret -}}{{ .Values.protection.cookieSecret.existingSecret }}{{- else -}}{{ include "pagedrop-host.fullname" . }}-cookie{{- end -}}
{{- end -}}

{{- define "pagedrop-host.cookieSecretKey" -}}
{{- default "cookieSecret" .Values.protection.cookieSecret.existingSecretKey -}}
{{- end -}}

{{/* True when a cookie secret is configured by value or existing Secret. */}}
{{- define "pagedrop-host.cookieSecretConfigured" -}}
{{- if or .Values.protection.cookieSecret.value .Values.protection.cookieSecret.existingSecret -}}true{{- end -}}
{{- end -}}
