/**
 * Build the argument array for spawning `ws` in the background.
 * 
 * When running from source (`bun apps/cli/src/index.ts ...`) we need to go through `bun`.
 * When running as a compiled binary (`bun build --compile`) the executable is
 * self-contained and must be invoked directly - passing it through `bun` fails
 * silently, which causes agents to never start
 */
export function buildBgArgs(args: string[]): string[] {
    const main = Bun.main;
    const isCompiled = !main.endsWith(".ts") && !main.endsWith(".js");
    if(isCompiled) {
        return [process.execPath, ...args];
    }
    return ["bun", main, ...args];
}