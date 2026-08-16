# Reusable helper for storing/retrieving the GitHub PAT used to publish
# MarbleGrid releases (electron-builder --publish always needs GH_TOKEN as
# a real env var — it does not use git's own credential system, confirmed
# 2026-08-16).
#
# Stored via Windows Credential Manager (CRED_TYPE_GENERIC), not a file:
# the blob is encrypted at rest via DPAPI under Noah's own Windows login,
# so copying the vault/project folder elsewhere does not get you a usable
# secret — same trust boundary Git Credential Manager already uses for
# plain `git push`. Deliberately a DIFFERENT credential-manager entry than
# git's own github.com one, so this never overwrites/interferes with
# whatever git already has cached for normal git push/pull.
#
# Usage:
#   . .\tools\gh-token-store.ps1
#   Set-MarbleGridGhToken -Token "ghp_..."   # store/overwrite (one-time, or whenever it's rotated)
#   $env:GH_TOKEN = Get-MarbleGridGhToken    # pull it back for a single command's use
#   Test-MarbleGridGhToken                   # $true/$false only — never prints the value

$script:TargetName = "MarbleGrid:GH_TOKEN"

Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class MarbleGridCredManager {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredWrite(ref CREDENTIAL userCredential, uint flags);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool CredFree(IntPtr cred);

    public static void Write(string target, string secret) {
        byte[] bytes = System.Text.Encoding.Unicode.GetBytes(secret);
        IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
        try {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            CREDENTIAL cred = new CREDENTIAL();
            cred.Type = 1; // CRED_TYPE_GENERIC
            cred.TargetName = target;
            cred.CredentialBlobSize = bytes.Length;
            cred.CredentialBlob = blob;
            cred.Persist = 2; // CRED_PERSIST_LOCAL_MACHINE — survives reboots, this Windows login only
            cred.UserName = "MarbleGrid";
            bool ok = CredWrite(ref cred, 0);
            if (!ok) throw new Exception("CredWrite failed: " + Marshal.GetLastWin32Error());
        } finally {
            Marshal.FreeHGlobal(blob);
        }
    }

    public static string Read(string target) {
        IntPtr credPtr;
        bool ok = CredRead(target, 1, 0, out credPtr);
        if (!ok) return null;
        try {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
            byte[] bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, cred.CredentialBlobSize);
            return System.Text.Encoding.Unicode.GetString(bytes);
        } finally {
            CredFree(credPtr);
        }
    }
}
"@

function Set-MarbleGridGhToken {
    param([Parameter(Mandatory)][string]$Token)
    [MarbleGridCredManager]::Write($script:TargetName, $Token)
    Write-Output "Stored in Windows Credential Manager as '$script:TargetName'."
}

function Get-MarbleGridGhToken {
    [MarbleGridCredManager]::Read($script:TargetName)
}

function Test-MarbleGridGhToken {
    $val = Get-MarbleGridGhToken
    return -not [string]::IsNullOrEmpty($val)
}
