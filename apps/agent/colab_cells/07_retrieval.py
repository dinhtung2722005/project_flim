from pjflim_agent.retrieval import HybridSearch
# E5 chạy CPU. Qwen dùng GPU nếu runtime/offload phù hợp.
search = HybridSearch(catalog, embedding_revision=MODEL_CONFIG["embeddingRevision"],
                      checkpoint_folder=WORKSPACE if CHECKPOINT_RESTORED else None)
search.save(WORKSPACE)
print("E5/FAISS sẵn sàng:", search.vectors.shape)
display([{"id": t.id, "name": t.name} for t in search.search("khoa học viễn tưởng", limit=3)])
