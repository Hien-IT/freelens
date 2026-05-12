# 1. Build tất cả packages và resources
pnpm build
# 2. Build app directory (tạo thư mục dist)
pnpm build:app:dir
# 3. Build app cho macOS (tạo file .dmg hoặc .app)
cd freelens && pnpm build:app:darwin
