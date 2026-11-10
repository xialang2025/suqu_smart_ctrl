<template>
    <view class="screen" data-page="devices">
        <view class="brand">速驱智控</view>
        <view class="subtitle">蓝牙设备 · 原始数据透传</view>
        <view class="section">
            <view class="section-title">设备页</view>
            <view class="notice" role="status">{{ state.message || '正在检查蓝牙状态…' }}</view>
        </view>
        <view class="empty">暂无设备<br />蓝牙设备将在这里显示</view>
    </view>
</template>
<script setup>
//20261110-0 add - Observe the shared application instead of owning native listeners.
import { shallowRef, onMounted, onUnmounted } from 'vue';
import { application } from '../../common/runtime.js';

const state = shallowRef({ ...application.state });
const unsubscribe = application.subscribe(observe);

/******************************************************************************
 * Function Name   : observe
 * Description     : Render a complete application transition in the device page.
 * Input Parameters: next
 * Return Value    : None
 * Date            : 2026.11.10
 ******************************************************************************/
function observe(next) {
    state.value = next;
}

onMounted(application.start);
onUnmounted(unsubscribe);
</script>
