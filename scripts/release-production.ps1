param(
  [string]$Version = '',
  [string]$Workflow = '.github/workflows/release.yml',
  [switch]$Wait,
  [string]$RepositoryRoot = '',
  [string]$ManifestPath = 'outputs/final/release-manifest.json'
)

$ErrorActionPreference = 'Stop'
throw 'RELEASE_PRODUCTION_NOT_IMPLEMENTED'

