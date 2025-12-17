# FROM 表示设置要制作的镜像基于哪个镜像，FROM指令必须是整个Dockerfile的第一个指令，如果指定的镜像不存在默认会自动从Docker Hub上下载。
# 如果不指定版本，会默认使用latest,就是最新版本
# --- 阶段 1: 构建 ---
FROM node:24.12.0 as builder

# 创建文件夹 这个文件夹是node环境下的
RUN mkdir -p /app/looplens/

# 将根目录下的文件都copy到container（运行此镜像的容器）文件系统的文件夹下
COPY . /app/looplens

# WORKDIR指令用于设置Dockerfile中的RUN、CMD和ENTRYPOINT指令执行命令的工作目录(默认为/目录)，该指令在Dockerfile文件中可以出现多次，如果使用相对路径则为相对于WORKDIR上一次的值，
# 例如WORKDIR /data，WORKDIR logs，RUN pwd最终输出的当前目录是/data/logs。
# cd到 /app/looplens
WORKDIR /app/looplens

# 安装项目依赖包
RUN npm install --registry=https://registry.npmmirror.com/

# 容器对外暴露的端口号(这个3000 必须是当前node项目的端口)
# EXPOSE 3000

RUN npm run build

# --- 阶段 2: Nginx 服务 ---
FROM nginx:alpine
# 复制构建产物到 Nginx 目录, 问AI给的是--from=builder，漏复制了上边FROM后的as导致指到线上仓库导致403，实际语法是--from=<builder>
# <builder>占位符对应前一个FROM镜像的自定义名称，可指定FROM xxx as <builder>，从而再在这里访问到前一个镜像阶段的构建产物
COPY --from=builder /app/looplens/dist /usr/share/nginx/html
# (可选) 复制自定义 Nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
# 容器启动时执行的命令，类似npm run start
# CMD ["npm", "run", "preview"]
