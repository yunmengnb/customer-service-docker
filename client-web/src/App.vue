<!-- 忆梦云团队开发 -->
<template>
  <router-view :key="$route.path" />
</template>

<script setup>
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; }
body {
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #f5f7fa;
  color: #1a1a1a;
}
</style>
