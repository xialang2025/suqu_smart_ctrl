<template>
    <view class="screen" data-page="devices">
        <view class="brand">速驱智控</view>
        <view class="subtitle">蓝牙设备 · 原始数据透传</view>
        <view class="section">
            <view class="section-title">设备页</view>
            <view class="notice" role="status">{{ state.message || '正在检查蓝牙状态…' }}</view>
            <view class="actions">
                <button class="primary" data-action="scan" :disabled="state.status === 'initializing'" @click="toggleScan">{{ state.scanning ? '停止扫描' : '重新扫描' }}</button>
                <button v-if="state.status === 'unavailable'" class="secondary" @click="openSettings">系统设置</button>
            </view>
        </view>
        <view v-for="device in state.devices" :key="device.deviceId" class="device-card" :data-device="device.deviceId">
            <view class="device-name">{{ device.name }}</view>
            <view class="device-address">{{ device.deviceId }}</view>
            <view class="device-meta">信号 {{ device.rssi }} dBm <text>未连接</text></view>
        </view>
        <view v-if="!state.devices.length" class="empty">{{ state.scanning ? '正在寻找附近的蓝牙设备…' : '暂无设备' }}<br />请确认模块已开启</view>
    </view>
</template>
<script setup>
//20261110-0 add - Observe the shared application instead of owning native listeners.
import { shallowRef, onMounted, onUnmounted } from 'vue';
import { application, platform } from '../../common/runtime.js';

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

/******************************************************************************
 * Function Name   : toggleScan
 * Description     : Stop scanning or recheck system prerequisites before another scan.
 * Input Parameters: None
 * Return Value    : Promise for the operation.
 * Date            : 2026.11.10
 ******************************************************************************/
async function toggleScan() { //20261110-1 add
    if (state.value.scanning) {
        await application.stopScan();
    } else {
        await application.start();
    }
}

/******************************************************************************
 * Function Name   : openSettings
 * Description     : Open Android settings to recover missing system prerequisites.
 * Input Parameters: None
 * Return Value    : Promise for the settings operation.
 * Date            : 2026.11.10
 ******************************************************************************/
async function openSettings() { //20261110-1 add
    try {
        await platform.openSettings();
    } catch (error) {
        uni.showToast({ title: error.message, icon: 'none' });
    }
}

onMounted(application.start);
onUnmounted(unsubscribe);
</script>
