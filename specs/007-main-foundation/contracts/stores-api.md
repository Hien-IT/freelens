# Contract: Stores, for the Later Core Areas

FR-010, research R11. `Stores` is built at startup and shared, cheap to clone,
as `Frames` is (`specs/004-cluster-frames/contracts/frames-api.md`).

```rust
pub struct Stores { /* the five stores, behind one lock */ }

pub enum StoreName { User, Hotbar, Favorites, Cluster, Weblink }

impl Stores {
    /// The data directory the stores live in.
    pub fn data_dir(&self) -> &Path;

    /// The preferences as the views see them now: the model of the user store.
    pub fn preferences(&self) -> Preferences;

    /// The model of one store, as `persistent-storage-initial-values` gives it.
    pub fn model(&self, store: StoreName) -> serde_json::Value;

    /// Replaces a store's model as a view's `store-sync-main` would: normalized,
    /// written, sent to every view. Returns false when nothing changed.
    pub fn update(&self, store: StoreName, model: serde_json::Value) -> bool;

    /// Calls `listener` with the store and its new model after every change,
    /// from a view or from an area, outside the lock.
    pub fn on_change(&self, listener: impl Fn(StoreName, &serde_json::Value) + Send + Sync + 'static);
}
```

`Preferences` is a typed view of the user store's model with the defaults of
[data-model.md](../data-model.md#preferences) applied, so an area reads
`preferences().https_proxy` rather than parsing JSON. It is a snapshot; an
area that must follow a setting listens with `on_change` for `StoreName::User`.

Rules:

- No area writes a store file itself; `update` is the only way in.
- `on_change` listeners must not block; one that needs I/O spawns it.
- An area that needs the cluster store's clusters gets their models only;
  what to do with them belongs to that area (main-cluster-connection,
  main-catalog).
