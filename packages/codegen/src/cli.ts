#!/usr/bin/env node
/**
 * `frappeforge-codegen` command-line entry point. Commands are added with the generator;
 * for now it only reports its version so the packaged binary can be smoke-tested.
 */
import { VERSION } from './index.js'

const args = process.argv.slice(2)

if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION)
} else {
    console.log(
        `frappeforge-codegen ${VERSION}\n\nNo commands are available yet. Run with --version to print the version.`,
    )
}
