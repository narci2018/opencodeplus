export * as RulesFiles from "./rules-files.js"

import { Schema } from "effect"

const FileRef = Schema.Struct({
  path: Schema.String,
  content: Schema.NullOr(Schema.String),
})

export const Info = Schema.Struct({
  rules: Schema.Struct({
    agents_md: Schema.Boolean,
    claude_md: Schema.Boolean,
  }),
  instructions: Schema.Array(Schema.String),
  globalAgents: FileRef,
  projectAgents: FileRef.pipe(Schema.optional),
  memory: Schema.Struct({
    enabled: Schema.Boolean,
    distill: Schema.Boolean,
    global: FileRef,
    project: FileRef.pipe(Schema.optional),
    projects: Schema.Array(
      Schema.Struct({
        projectID: Schema.String,
        name: Schema.String,
        directory: Schema.String,
        path: Schema.String,
      }),
    ),
  }),
}).annotate({ identifier: "RulesFiles.Info" })

export type Info = typeof Info.Type
