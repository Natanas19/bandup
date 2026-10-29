# PREPARED FOR REVIEW ONLY. Never invoked during implementation/static tests.
# One explicit artifact per invocation; no sequence, retries, cleanup or ledger repair.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Bootstrap','BootstrapChecks','M1','M2','M3','M4','M5','M6','M8','PostM8','LegacyFixture','UrlFixture',
        'NegativeBridge','Bridge','Interstage','NegativeUrl','Url','Publication','Profiles',
        'UrlTests','FunctionalFixture','M10','FunctionalTests')]
    [string] $Artifact,
    [switch] $ExecuteReviewedSql,
    [string] $PassFile
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $ExecuteReviewedSql) { throw 'Review and separate execution authorization required; nothing connected.' }

# No connection-string, host, port, database, username, SQL text or file override.
$labHost = '127.0.0.1'
$labPort = 5434
$labDatabase = 'bandup_publication_compat_test'
$labSystemIdentifier = '7701800113631615116'
if ($labHost -cne '127.0.0.1' -or $labPort -ne 5434 -or $labPort -eq 5433 -or
    $labDatabase -cne 'bandup_publication_compat_test' -or $labSystemIdentifier -cne '7701800113631615116') {
    throw 'Forbidden destination, including restored 5433 and production.'
}
$supabaseRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artifacts = @{
    Bootstrap = 'tests/compatibility_lab_bootstrap.sql'
    BootstrapChecks = 'tests/compatibility_lab_bootstrap_checks.sql'
    M1 = 'migrations/20261001000000_initial_bandup_schema.sql'
    M2 = 'migrations/20261002160000_tasks_delete_admins_only.sql'
    M3 = 'migrations/20261002170000_events_delete_admins_only.sql'
    M4 = 'migrations/20261002190800_events_custom_event_type.sql'
    M5 = 'migrations/20261002200000_tasks_optional_event_link.sql'
    M6 = 'migrations/20261017180000_record_ownership_guards.sql'
    M8 = 'migrations/20261023000000_tasks_ownership_immutable.sql'
    PostM8 = 'tests/compatibility_post_m8.sql'
    LegacyFixture = 'tests/legacy_publication_fixture.sql'
    UrlFixture = 'tests/compatibility_url_fixture.sql'
    NegativeBridge = 'tests/compatibility_negative_bridge.sql'
    Bridge = 'migrations/20261028000000_legacy_publication_compatibility.sql'
    Interstage = 'tests/compatibility_interstage_publication.sql'
    NegativeUrl = 'tests/compatibility_negative_url.sql'
    Url = 'migrations/20261028010000_legacy_external_link_url_safety.sql'
    Publication = 'tests/publication_compatibility.sql'
    Profiles = 'tests/compatibility_public_band_profiles.sql'
    UrlTests = 'tests/compatibility_url_safety.sql'
    FunctionalFixture = 'tests/compatibility_functional_integrity_legacy_fixture.sql'
    M10 = 'migrations/20261027010000_functional_integrity.sql'
    FunctionalTests = 'tests/compatibility_functional_integrity.sql'
}
$manifest = Get-Content -LiteralPath (Join-Path $supabaseRoot 'compatibility-publication.manifest.json') -Raw | ConvertFrom-Json
$expectedOrder = @($artifacts.Bridge, $artifacts.Url, $artifacts.M10)
$excluded = @('migrations/20261020000000_public_band_profiles.sql','migrations/20261027000000_external_link_url_safety.sql')
if ($manifest.automaticDbPush -ne $false -or
    (@($manifest.orderedCandidates) -join '|') -cne ($expectedOrder -join '|') -or
    (@($manifest.excludedOriginalAlternatives) -join '|') -cne ($excluded -join '|')) {
    throw 'Manifest differs from reviewed branch; stop for review.'
}
$sqlPath = [IO.Path]::GetFullPath((Join-Path $supabaseRoot $artifacts[$Artifact]))
if (-not $sqlPath.StartsWith($supabaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $sqlPath -PathType Leaf)) { throw 'Invalid reviewed artifact.' }
$identityPath = Join-Path $PSScriptRoot 'compatibility_lab_identity.sql'
$psqlCommand = Get-Command psql -CommandType Application -ErrorAction Stop

# Prevent inherited PGSERVICE/PGHOST/PGPORT/PGOPTIONS, credentials or target overrides.
# Never print environment values; restore all of them even on failure.
$savedPgEnvironment = @{}
$processEnvironment = [Environment]::GetEnvironmentVariables('Process')
foreach ($name in $processEnvironment.Keys) {
    if ([string]$name -like 'PG*') { $savedPgEnvironment[[string]$name] = [string]$processEnvironment[$name] }
}
if ($PassFile) {
    if ($PassFile -notmatch '^[A-Za-z]:[\\/]' -or
        ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($PassFile))).DriveType -ne [IO.DriveType]::Fixed) {
        throw 'PassFile must be an absolute path on a local fixed drive; no UNC, URI or network drive.'
    }
    $reviewedPassFile = (Resolve-Path -LiteralPath $PassFile -ErrorAction Stop).ProviderPath
    if (-not (Test-Path -LiteralPath $reviewedPassFile -PathType Leaf)) { throw 'PassFile must be a reviewed local file.' }
} else {
    # Disable implicit user-profile pgpass without creating any file.
    $reviewedPassFile = Join-Path ([IO.Path]::GetTempPath()) ('bandup-no-password-' + [guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $reviewedPassFile) { throw 'Unexpected password-file collision.' }
}
try {
    foreach ($name in $savedPgEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    [Environment]::SetEnvironmentVariable('PGPASSFILE', $reviewedPassFile, 'Process')
    $connection = "host=$labHost hostaddr=$labHost port=$labPort dbname=$labDatabase user=postgres sslmode=disable connect_timeout=5 application_name=bandup_synthetic_lab"
    $psqlArguments = @('-X','-w','--dbname', $connection,'-P','pager=off',
        '-v','ON_ERROR_STOP=1','-v',"bandup_expected_database=$labDatabase",
        '-v',"bandup_expected_system_identifier=$labSystemIdentifier",'-f',$identityPath,
        '-c',"SET statement_timeout='60s'; SET lock_timeout='5s'; SET idle_in_transaction_session_timeout='60s';")
    # These historical files lack their own transaction. Gate runs BEFORE BEGIN.
    $wrapTransaction = $Artifact -in @('M1','M2','M3','M4','M5','M8')
    if ($wrapTransaction) { $psqlArguments += @('-c','BEGIN;') }
    $psqlArguments += @('-f',$sqlPath)
    if ($wrapTransaction) { $psqlArguments += @('-c','COMMIT;') }
    & $psqlCommand.Source @psqlArguments
    if ($LASTEXITCODE -ne 0) { throw 'SQL stopped: inspect state; no retry, cleanup or next artifact.' }
} finally {
    [Environment]::SetEnvironmentVariable('PGPASSFILE', $null, 'Process')
    foreach ($name in $savedPgEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedPgEnvironment[$name], 'Process') }
}
