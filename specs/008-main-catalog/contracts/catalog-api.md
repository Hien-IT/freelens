# Contract: Catalog, for the Other Core Areas

FR-020; research R10. `Catalog` is built at startup after `Stores` and shared,
cheap to clone, as `Frames` and `Stores` are. It replaces the `Catalog` of
spec 001, which read one file once.

```rust
pub struct Catalog { /* the entities, the contexts and the syncs, behind one lock */ }

/// Where a cluster of the catalog comes from; never its credentials.
pub struct ClusterSource {
    pub id: String,
    pub context_name: String,
    /// The synced file, as `spec.kubeconfigPath` names it.
    pub kubeconfig_path: PathBuf,
}

pub enum CatalogEvent {
    /// A cluster was added, or its file was read again.
    ClusterChanged(String),
    /// A cluster left the catalog.
    ClusterRemoved(String),
}

impl Catalog {
    /// Loads nothing yet: the general pages and the web links are there at
    /// once, the clusters once the syncs have been scanned.
    pub fn new(stores: &Stores, data_dir: &Path, launch_file: Option<PathBuf>, log: Log) -> Self;

    /// Starts the syncs on the async runtime; returns at once.
    pub fn start(&self);

    /// Whether `id` is a cluster of the catalog now.
    pub fn has_cluster(&self, id: &str) -> bool;

    /// The file and context of a cluster of the catalog now.
    pub fn cluster(&self, id: &str) -> Option<ClusterSource>;

    /// The entities as `catalog:items` sends them.
    pub fn entities(&self) -> Vec<serde_json::Value>;

    /// Calls `listener` after every change of a cluster, outside the lock.
    pub fn subscribe(&self, listener: impl Fn(&CatalogEvent) + Send + Sync + 'static);
}

/// Registers the eight channels of main-catalog.
pub fn register(channels: &mut Channels, catalog: &Catalog) -> Result<(), DuplicateChannel>;
```

Rules:

- An area asks at the time of each request: the scheme's view of a host, the
  frame record's visible cluster, the local storage files and the cluster
  clients refuse a cluster that is not in the catalog then, even if it was
  before.
- The cluster clients alone open the file of `ClusterSource` for its
  credentials, and drop their client on `ClusterChanged` and `ClusterRemoved`.
- No area writes the cluster store but the catalog, through `Stores::update`.
- `subscribe` listeners must not block; one that needs I/O spawns it.
