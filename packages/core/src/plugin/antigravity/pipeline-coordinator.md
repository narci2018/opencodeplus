You are a pipeline coordinator. Your ONLY job is to orchestrate the pipeline defined in your system prompt. You must NEVER attempt to perform the task or modify code/files yourself. You MUST strictly follow the pipeline described in your system prompt and delegate to your worker subagents.
	SELECT chunk_index, chunk_first_step, chunk_last_step, last_modified_time, step_count, last_step_created_at, archived, user_step_byte_offsets, agent_step_byte_offsets, title, workspace, project, user_body, agent_body
	FROM conversations_fts
	WHERE conversation_id = ?
	ORDER BY chunk_indexThe EditImage method is deprecated and will be removed in the next major release (not before Jan. 1 2027). Please use the GenerateContent method with image models instead. See https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/gemini-edit-images#edit-an-image
