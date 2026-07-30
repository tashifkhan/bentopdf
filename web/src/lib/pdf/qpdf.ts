/**
 * qpdf-wasm bindings.
 *
 * Everything here is browser-only and dynamically imported at call time so the
 * 1.3 MB wasm binary never enters the SSR bundle or the initial page payload.
 */

type QpdfFS = {
  writeFile: (path: string, data: Uint8Array) => void;
  readFile: (path: string, opts?: { encoding?: string }) => Uint8Array;
  unlink: (path: string) => void;
};

type QpdfInstance = {
  callMain: (args: string[]) => number;
  FS: QpdfFS;
};

const INPUT = '/input.pdf';
const OUTPUT = '/output.pdf';

async function createQpdf(): Promise<QpdfInstance> {
  if (typeof window === 'undefined') {
    throw new Error('PDF encryption is only available in the browser');
  }
  const mod = await import('@neslinesli93/qpdf-wasm');
  const factory = (mod.default ?? mod) as unknown as (opts: {
    locateFile: () => string;
  }) => Promise<QpdfInstance>;
  // A fresh instance per run: emscripten's callMain tears down the runtime on
  // exit, so reusing one instance across operations is not reliable.
  return factory({ locateFile: () => '/qpdf.wasm' });
}

/** Run qpdf against one input file and return the produced output. */
async function runQpdf(
  file: File,
  buildArgs: (input: string, output: string) => string[],
  errorHint: string
): Promise<Uint8Array> {
  const qpdf = await createQpdf();
  const input = new Uint8Array(await file.arrayBuffer());
  qpdf.FS.writeFile(INPUT, input);
  try {
    let code: number;
    try {
      code = qpdf.callMain(buildArgs(INPUT, OUTPUT));
    } catch (e) {
      throw new Error(
        `${errorHint} (${e instanceof Error ? e.message : 'qpdf error'})`,
        {
          cause: e,
        }
      );
    }
    // qpdf uses exit code 3 for warnings that still produce valid output.
    if (code !== 0 && code !== 3) {
      throw new Error(errorHint);
    }
    const out = qpdf.FS.readFile(OUTPUT);
    if (!out || out.length === 0)
      throw new Error(`${errorHint} — empty result`);
    return new Uint8Array(out);
  } finally {
    for (const path of [INPUT, OUTPUT]) {
      try {
        qpdf.FS.unlink(path);
      } catch {
        // Already gone — nothing to clean up.
      }
    }
  }
}

export type Permissions = {
  print: 'full' | 'low' | 'none';
  modify: 'all' | 'annotate' | 'form' | 'assembly' | 'none';
  extract: boolean;
  accessibility: boolean;
};

function permissionArgs(p: Permissions): string[] {
  return [
    `--print=${p.print}`,
    `--modify=${p.modify}`,
    `--extract=${p.extract ? 'y' : 'n'}`,
    `--accessibility=${p.accessibility ? 'y' : 'n'}`,
  ];
}

/** Encrypt with 256-bit AES. */
export async function encryptPdf(
  file: File,
  userPassword: string,
  ownerPassword: string,
  permissions?: Permissions
): Promise<Uint8Array> {
  if (!userPassword && !ownerPassword) {
    throw new Error('Enter at least one password');
  }
  const owner = ownerPassword || userPassword;
  return runQpdf(
    file,
    (input, output) => [
      input,
      '--encrypt',
      userPassword,
      owner,
      '256',
      ...(permissions ? permissionArgs(permissions) : []),
      '--',
      output,
    ],
    'Encryption failed — the PDF may already be password protected'
  );
}

/** Decrypt using the supplied password. */
export async function decryptPdf(
  file: File,
  password: string
): Promise<Uint8Array> {
  if (!password) throw new Error('Enter the PDF password');
  return runQpdf(
    file,
    (input, output) => [
      input,
      `--password=${password}`,
      '--decrypt',
      '--',
      output,
    ],
    'Decryption failed — check the password'
  );
}

/**
 * Change permissions on an already-protected PDF. Requires the owner password,
 * since re-encrypting means decrypting first.
 */
export async function changePermissions(
  file: File,
  password: string,
  userPassword: string,
  ownerPassword: string,
  permissions: Permissions
): Promise<Uint8Array> {
  if (!ownerPassword)
    throw new Error('An owner password is required to set permissions');
  return runQpdf(
    file,
    (input, output) => [
      input,
      ...(password ? [`--password=${password}`] : []),
      '--encrypt',
      userPassword,
      ownerPassword,
      '256',
      ...permissionArgs(permissions),
      '--',
      output,
    ],
    'Could not change permissions — check the owner password'
  );
}

/**
 * Strip owner-password restrictions. This only works on PDFs that open without
 * a user password; it is not a password cracker.
 */
export async function removeRestrictions(
  file: File,
  password = ''
): Promise<Uint8Array> {
  return runQpdf(
    file,
    (input, output) => [
      input,
      ...(password ? [`--password=${password}`] : []),
      '--decrypt',
      '--',
      output,
    ],
    'Could not remove restrictions — this PDF needs a password to open'
  );
}

/** Linearize ("fast web view") so viewers can render page 1 before the full download. */
export async function linearizePdf(file: File): Promise<Uint8Array> {
  return runQpdf(
    file,
    (input, output) => [input, '--linearize', '--', output],
    'Linearization failed'
  );
}

/** Structural repair: qpdf rebuilds the xref table and object streams. */
export async function repairPdf(file: File): Promise<Uint8Array> {
  return runQpdf(
    file,
    // `--replace-input` is a bare flag that rewrites the input in place; it
    // cannot be combined with an output file.
    (input, output) => [input, '--object-streams=generate', '--', output],
    'Repair failed — the file may be too badly damaged'
  );
}

/** True when the PDF is encrypted at all. */
export async function isEncrypted(file: File): Promise<boolean> {
  const head = new Uint8Array(
    await file.slice(0, Math.min(file.size, 4096)).arrayBuffer()
  );
  const text = new TextDecoder('latin1').decode(head);
  return text.includes('/Encrypt');
}
