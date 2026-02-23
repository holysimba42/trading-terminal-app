{
  "targets": [{
    "target_name": "webull_ghost",
    "sources": [ "execution.cpp" ],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
    "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
    "conditions": [
      ["OS=='win'", {
        "defines": [ "NOMINMAX", "UNICODE", "_UNICODE" ]
      }]
    ]
  }]
}
