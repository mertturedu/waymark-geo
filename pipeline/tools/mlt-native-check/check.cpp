#include <mlt/decoder.hpp>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>
#include <exception>

int main(int argc, char** argv) {
    if (argc < 2) return 2;
    FILE* in = std::fopen(argv[1], "rb");
    if (!in) return 2;
    std::uint64_t ok = 0, bad = 0;
    for (;;) {
        std::uint64_t id = 0;
        std::uint32_t len = 0;
        if (std::fread(&id, 8, 1, in) != 1) break;
        if (std::fread(&len, 4, 1, in) != 1) break;
        std::string data(len, '\0');
        if (len > 0 && std::fread(data.data(), 1, len, in) != len) break;
        try {
            mlt::Decoder decoder(false);
            auto tile = decoder.decode(mlt::DataView(data));
            std::uint64_t features = 0;
            for (const auto& layer : tile.getLayers()) features += layer.getFeatures().size();
            ++ok;
            if (argc > 2) std::printf("OK %llu %llu\n", (unsigned long long)id, (unsigned long long)features);
        } catch (const std::exception& e) {
            ++bad;
            std::printf("FAIL %llu %s\n", (unsigned long long)id, e.what());
        }
    }
    std::printf("ok=%llu fail=%llu\n", (unsigned long long)ok, (unsigned long long)bad);
    return bad == 0 ? 0 : 1;
}
