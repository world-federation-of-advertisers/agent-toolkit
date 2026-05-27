<#
.SYNOPSIS
  Cross-OS secret storage helper for Halo API credentials (Windows backend).

.DESCRIPTION
  Stores values in PowerShell SecretManagement under namespace
  "halo-reporting-api" so credentials never touch shell history or
  world-readable files on disk.

  One-time prereqs (run elevated PowerShell):
    Install-Module Microsoft.PowerShell.SecretManagement -Scope CurrentUser
    Install-Module Microsoft.PowerShell.SecretStore       -Scope CurrentUser
    Register-SecretVault -Name SecretStore `
        -ModuleName Microsoft.PowerShell.SecretStore -DefaultVault

  On first read of a SecretStore vault you will be prompted to set a
  master password. Save it somewhere safe.

.PARAMETER Command
  One of: set, get, delete.

.PARAMETER Name
  The short secret name (e.g. halo_client_id). Must match [a-zA-Z0-9_-]+.

.EXAMPLE
  pwsh ./halo-secrets.ps1 -Command set    -Name halo_client_id
  pwsh ./halo-secrets.ps1 -Command get    -Name halo_client_id
  pwsh ./halo-secrets.ps1 -Command delete -Name halo_client_id
#>

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('set', 'get', 'delete')]
    [string]$Command,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-zA-Z0-9_-]+$')]
    [string]$Name
)

$ErrorActionPreference = 'Stop'

$Namespace = 'halo-reporting-api'
$Key = "${Namespace}:${Name}"

if (-not (Get-Module -ListAvailable -Name Microsoft.PowerShell.SecretManagement)) {
    Write-Error @"
Microsoft.PowerShell.SecretManagement is not installed.
Run (in an elevated PowerShell):
  Install-Module Microsoft.PowerShell.SecretManagement -Scope CurrentUser
  Install-Module Microsoft.PowerShell.SecretStore       -Scope CurrentUser
  Register-SecretVault -Name SecretStore -ModuleName Microsoft.PowerShell.SecretStore -DefaultVault
"@
    exit 1
}

switch ($Command) {
    'set' {
        # Read-Host -AsSecureString does not echo the typed value.
        $secure = Read-Host -Prompt "Value for $Name (input hidden)" -AsSecureString
        Set-Secret -Name $Key -SecureStringSecret $secure | Out-Null
    }
    'get' {
        # Print to stdout WITHOUT a trailing newline so the value can be
        # captured cleanly into shell variables:
        #   $env:CLIENT_ID = (pwsh ./halo-secrets.ps1 -Command get -Name halo_client_id)
        $value = Get-Secret -Name $Key -AsPlainText
        [Console]::Out.Write($value)
    }
    'delete' {
        Remove-Secret -Name $Key
    }
}
