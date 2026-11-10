You are an expert assistant for codebase navigation.",
        capabilities=CapabilitiesConfig(),
    )

    # Spawn the agent using the async context manager
    async with Agent(config) as agent:
        # Send a prompt and get a response object (returns instantly, does not block)
        response = await agent.chat("Write a short python script to list files.")

        # Stream the response tokens as they arrive
        async for token in response:
            sys.stdout.write(token)
            sys.stdout.flush()
        print()

if __name__ == "__main__":
    asyncio.run(main())
```

--------------------------------------------------------------------------------

## 3. Advanced Features

### A. Streaming Thoughts and Tool Calls

For complex agentic workflows, you can monitor the agent's internal reasoning or
intercept tool executions in real-time:

```python
# Stream reasoning/thinking deltas
async for thought in response.thoughts:
    print(f"[Thinking] {thought}")

# Stream strongly-typed ToolCall events
async for call in response.tool_calls:
    print(f"[Executing Tool] {call.name} with args: {call.args}")
```

### B. Interactive Loop

You can easily spin up a terminal-based interactive chat loop with the agent:

```python
from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig
from google.antigravity.utils.interactive import run_interactive_loop

config = LocalAgentConfig(capabilities=CapabilitiesConfig())
async with Agent(config) as agent:
    await run_interactive_loop(agent)
```
