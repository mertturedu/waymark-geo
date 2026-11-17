#pragma once
#include <cstddef>
#include <cstdint>
namespace FastPForLib {
template <unsigned N> struct FastPFor {};
struct VariableByte {};
template <class A, class B> struct CompositeCodec {
    const std::uint32_t* decodeArray(const std::uint32_t* in, std::size_t, std::uint32_t*, std::size_t&) { return in; }
};
}
