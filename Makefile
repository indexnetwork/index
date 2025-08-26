## LLM ctx helpers

.PHONY: ctx ctx-full ctx-public ctx-clean

ctx:
	bash scripts/generate-ctx.sh

ctx-full:
	LLMSTXT_FILE=llms.txt bash scripts/generate-ctx.sh

ctx-public: ctx
	cp -f llms-ctx.txt llms-ctx-full.txt frontend/public/

ctx-clean:
	rm -f llms-ctx.txt llms-ctx-full.txt frontend/public/llms-ctx.txt frontend/public/llms-ctx-full.txt

