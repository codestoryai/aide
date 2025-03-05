# Automated Agents in Aide

## Identifying Agents

All automated agents in the Aide repository are clearly marked with the following indicators:

1. **Bot Account**: Agents operate through dedicated GitHub accounts with "[bot]" in their username (e.g., `aide-agent[bot]`).
2. **Profile Badge**: Agent profiles include a 🤖 emoji and "Automated Agent" in their bio.
3. **Comment Header**: All comments from agents begin with a header that identifies them as automated:

```
🤖 **I am an automated agent** | [How to interact with me](https://github.com/codestoryai/aide/blob/cs-main/docs/AGENTS.md)
```

## Current Agents

- **@aide-agent[bot]**: General purpose agent that works on issues and pull requests
- **@theskcd[bot]**: Legacy agent account (being migrated to the new format)

## How to Interact with Agents

You can interact with our agents using special commands in your comments:

- `/agent` - Ask the agent to work on the current issue
- `/q <your question>` - Ask the agent a specific question

## Agent Limitations

Please be aware that:
- Agents can only access public repository data
- Agents cannot execute code or perform actions outside of commenting
- Human maintainers review agent activity regularly

## Reporting Issues

If you encounter any problems with our automated agents, please [open an issue](https://github.com/codestoryai/aide/issues/new) with the tag `agent-issue`.