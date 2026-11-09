import { chmod, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

/** Only call after fixture Hosts are closed, with their explicitly owned temporary root. */
export async function removeSkillBuildFixture(root: string): Promise<void> {
  async function unlock(directory: string): Promise<void> {
    await chmod(directory, 0o755)
    for (const entry of await readdir(directory, { withFileTypes: true }))
      if (entry.isDirectory()) await unlock(path.join(directory, entry.name))
  }
  await unlock(root)
  await rm(root, { recursive: true, force: true })
}
